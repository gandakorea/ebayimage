export type WorkMode = 'auto' | 'label' | 'box' | 'product';
export type ResolvedMode = Exclude<WorkMode, 'auto'>;
export type BoundingBox = [number, number, number, number];

export type RemoveRegion = {
  kind: 'watermark' | 'shadow' | 'ui' | 'badge' | 'artifact';
  box: BoundingBox;
  overlapsProtectedContent: boolean;
};

export type ImageAnalysis = {
  partNumber: string | null;
  partNumberConfidence: number;
  mode: ResolvedMode;
  modeConfidence: number;
  hasProduct: boolean;
  hasBox: boolean;
  hasStandaloneLabel: boolean;
  hasHologram: boolean;
  attachedBoxLabelPresent: boolean;
  hasOriginalWatermark: boolean;
  hasShadowOrDirtyBackground: boolean;
  backgroundIsPureWhite: boolean;
  productBox: BoundingBox | null;
  boxBox: BoundingBox | null;
  standaloneLabelBox: BoundingBox | null;
  hologramBox: BoundingBox | null;
  attachedLabelBox: BoundingBox | null;
  contentBox: BoundingBox | null;
  removeRegions: RemoveRegion[];
  needsReview: boolean;
  reviewReasons: string[];
};

export type ManualRegions = {
  productBox: BoundingBox | null;
  contentBox: BoundingBox | null;
  labelBox: BoundingBox | null;
  hologramBox: BoundingBox | null;
  watermarkBoxes: BoundingBox[];
  whiteoutBoxes: BoundingBox[];
};

export type ManualProcessedImage = {
  result: Blob;
  aiEdited: boolean;
};

export type ProcessedImage = {
  analysis: ImageAnalysis;
  mode: ResolvedMode;
  partNumber: string | null;
  result: Blob;
  reviewReasons: string[];
  aiConnected: boolean;
  aiEdited: boolean;
  watermarkVerified: boolean;
};

type PipelineErrorBody = {
  code?: string;
  message?: string;
};

class PipelineError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MAX_ANALYSIS_UPLOAD_BYTES = 900 * 1024;

export function normalizePartNumber(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length < 6 || compact.length > 16) return null;
  return `${compact.slice(0, 5)}-${compact.slice(5)}`;
}

export function partNumberFromFileName(fileName: string) {
  const match = fileName.toUpperCase().match(/(\d{5})[\s_-]?([A-Z0-9]{5,11})/);
  return match ? normalizePartNumber(`${match[1]}${match[2]}`) : null;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 이미지를 만들지 못했습니다.'));
    }, type, quality);
  });
}

async function prepareAnalysisUpload(image: Blob) {
  const bitmap = await createImageBitmap(image);
  const candidates = [
    { maxDimension: 896, quality: 0.86 },
    { maxDimension: 768, quality: 0.78 },
    { maxDimension: 640, quality: 0.7 },
  ];
  let lastBlob: Blob | null = null;

  try {
    for (const candidate of candidates) {
      const scale = Math.min(
        1,
        candidate.maxDimension / Math.max(bitmap.width, bitmap.height),
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('검사용 이미지를 준비하지 못했습니다.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      lastBlob = await canvasToBlob(canvas, 'image/jpeg', candidate.quality);
      if (lastBlob.size <= MAX_ANALYSIS_UPLOAD_BYTES) return lastBlob;
    }
  } finally {
    bitmap.close();
  }

  if (!lastBlob) throw new Error('검사용 이미지를 준비하지 못했습니다.');
  return lastBlob;
}

async function prepareEditUpload(image: Blob) {
  const bitmap = await createImageBitmap(image);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('AI 편집용 이미지를 준비하지 못했습니다.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvasToBlob(canvas, 'image/jpeg', 0.92);
}

async function prepareSquareSource(file: File, size = 1024) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('이미지 캔버스를 준비하지 못했습니다.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  bitmap.close();
  return canvasToBlob(canvas);
}

async function callAnalysis(
  image: Blob,
  focus: 'full' | 'watermark' = 'full',
) {
  const analysisUpload = await prepareAnalysisUpload(image);
  const form = new FormData();
  form.append('image', analysisUpload, 'analysis.jpg');
  form.append('focus', focus);
  const response = await fetch('/api/analyze', { method: 'POST', body: form });
  const responseText = await response.text();
  let payload: ({
    analysis?: ImageAnalysis;
  } & PipelineErrorBody) | null = null;
  try {
    payload = JSON.parse(responseText) as {
      analysis?: ImageAnalysis;
    } & PipelineErrorBody;
  } catch {
    throw new PipelineError(
      response.status === 413 ? 'analysis_payload_too_large' : 'invalid_analysis_response',
      response.status === 413
        ? '검사용 이미지 전송 용량이 너무 큽니다.'
        : '이미지 분석 서버가 올바르지 않은 응답을 보냈습니다.',
    );
  }
  if (!response.ok || !payload.analysis) {
    throw new PipelineError(
      payload.code ?? 'analysis_failed',
      payload.message ?? '이미지 분석에 실패했습니다.',
    );
  }
  return payload.analysis;
}

async function createEditMask(image: Blob, regions: RemoveRegion[]) {
  const bitmap = await createImageBitmap(image);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  bitmap.close();
  const context = canvas.getContext('2d');
  if (!context) throw new Error('AI 편집 마스크를 만들지 못했습니다.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const region of regions) {
    const { left, top, right, bottom } = expandedRegionBounds(
      canvas.width,
      canvas.height,
      region,
    );
    context.clearRect(left, top, right - left, bottom - top);
  }

  return canvasToBlob(canvas);
}

async function callImageEdit(
  image: Blob,
  mask: Blob,
  mode: ResolvedMode,
) {
  const editUpload = await prepareEditUpload(image);
  const form = new FormData();
  form.append('image', editUpload, 'source.jpg');
  form.append('mask', mask, 'mask.png');
  form.append('mode', mode);
  const response = await fetch('/api/edit', { method: 'POST', body: form });
  const responseText = await response.text();
  let payload: ({ image?: string } & PipelineErrorBody) | null = null;
  try {
    payload = JSON.parse(responseText) as {
      image?: string;
    } & PipelineErrorBody;
  } catch {
    throw new PipelineError(
      response.status === 413 ? 'edit_payload_too_large' : 'invalid_edit_response',
      response.status === 413
        ? 'AI 편집용 이미지 전송 용량이 너무 큽니다.'
        : 'AI 편집 서버가 올바르지 않은 응답을 보냈습니다.',
    );
  }
  if (!response.ok || !payload.image) {
    throw new PipelineError(
      payload.code ?? 'image_edit_failed',
      payload.message ?? 'AI 이미지 편집에 실패했습니다.',
    );
  }

  const editedResponse = await fetch(payload.image);
  if (!editedResponse.ok) {
    throw new PipelineError(
      'invalid_image_edit',
      'AI 편집 결과를 불러오지 못했습니다.',
    );
  }
  return editedResponse.blob();
}

function regionPixelBounds(
  width: number,
  height: number,
  box: BoundingBox,
) {
  const [x, y, regionWidth, regionHeight] = box;
  const left = Math.max(0, Math.floor((x / 1000) * width));
  const top = Math.max(0, Math.floor((y / 1000) * height));
  const right = Math.min(
    width,
    Math.ceil(((x + regionWidth) / 1000) * width),
  );
  const bottom = Math.min(
    height,
    Math.ceil(((y + regionHeight) / 1000) * height),
  );
  return { left, top, right, bottom };
}

function expandedRegionBounds(
  width: number,
  height: number,
  region: RemoveRegion,
) {
  const bounds = regionPixelBounds(width, height, region.box);
  const padding = region.kind === 'watermark' ? 24 : 12;
  return {
    left: Math.max(0, bounds.left - padding),
    top: Math.max(0, bounds.top - padding),
    right: Math.min(width, bounds.right + padding),
    bottom: Math.min(height, bounds.bottom + padding),
  };
}

async function mergeEditedRegions(
  baseImage: Blob,
  editedImage: Blob,
  regions: RemoveRegion[],
) {
  const [base, edited] = await Promise.all([
    createImageBitmap(baseImage),
    createImageBitmap(editedImage),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const context = canvas.getContext('2d');
  if (!context) {
    base.close();
    edited.close();
    throw new Error('AI 편집 결과를 원본에 합성하지 못했습니다.');
  }
  context.drawImage(base, 0, 0);

  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = canvas.width;
  patchCanvas.height = canvas.height;
  const patchContext = patchCanvas.getContext('2d');
  if (!patchContext) {
    base.close();
    edited.close();
    throw new Error('AI 편집 영역을 준비하지 못했습니다.');
  }
  patchContext.drawImage(edited, 0, 0, canvas.width, canvas.height);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = canvas.width;
  maskCanvas.height = canvas.height;
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) {
    base.close();
    edited.close();
    throw new Error('AI 편집 합성 마스크를 준비하지 못했습니다.');
  }
  const maskPixels = maskContext.createImageData(canvas.width, canvas.height);
  const feather = 12;
  for (const region of regions) {
    const { left, top, right, bottom } = expandedRegionBounds(
      canvas.width,
      canvas.height,
      region,
    );
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const edgeDistance = Math.min(
          left === 0 ? feather : x - left,
          top === 0 ? feather : y - top,
          right === canvas.width ? feather : right - 1 - x,
          bottom === canvas.height ? feather : bottom - 1 - y,
        );
        const alpha = Math.round(
          255 * Math.min(1, Math.max(0, (edgeDistance + 1) / feather)),
        );
        const index = (y * canvas.width + x) * 4;
        if (alpha <= maskPixels.data[index + 3]) continue;
        maskPixels.data[index] = 255;
        maskPixels.data[index + 1] = 255;
        maskPixels.data[index + 2] = 255;
        maskPixels.data[index + 3] = alpha;
      }
    }
  }
  maskContext.putImageData(maskPixels, 0, 0);
  patchContext.globalCompositeOperation = 'destination-in';
  patchContext.drawImage(maskCanvas, 0, 0);
  context.drawImage(patchCanvas, 0, 0);
  base.close();
  edited.close();
  return canvasToBlob(canvas);
}

async function preserveOriginalSilhouette(
  originalImage: Blob,
  workingImage: Blob,
) {
  const [original, working] = await Promise.all([
    createImageBitmap(originalImage),
    createImageBitmap(workingImage),
  ]);
  const originalCanvas = document.createElement('canvas');
  const outputCanvas = document.createElement('canvas');
  originalCanvas.width = outputCanvas.width = original.width;
  originalCanvas.height = outputCanvas.height = original.height;
  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
  const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!originalContext || !outputContext) {
    original.close();
    working.close();
    throw new Error('제품 경계 보호 처리를 실행하지 못했습니다.');
  }
  originalContext.drawImage(original, 0, 0);
  outputContext.drawImage(working, 0, 0, original.width, original.height);
  const originalPixels = originalContext.getImageData(0, 0, original.width, original.height);
  const outputPixels = outputContext.getImageData(0, 0, original.width, original.height);
  const total = original.width * original.height;
  const background = new Uint8Array(total);
  const queue = new Int32Array(total);
  let queueStart = 0;
  let queueEnd = 0;
  const isBackground = (pixel: number) => {
    const index = pixel * 4;
    const red = originalPixels.data[index];
    const green = originalPixels.data[index + 1];
    const blue = originalPixels.data[index + 2];
    const minimum = Math.min(red, green, blue);
    const maximum = Math.max(red, green, blue);
    const average = (red + green + blue) / 3;
    return minimum >= 240 || (maximum - minimum <= 15 && average >= 218);
  };
  const enqueue = (pixel: number) => {
    if (background[pixel] || !isBackground(pixel)) return;
    background[pixel] = 1;
    queue[queueEnd] = pixel;
    queueEnd += 1;
  };
  for (let x = 0; x < original.width; x += 1) {
    enqueue(x);
    enqueue((original.height - 1) * original.width + x);
  }
  for (let y = 0; y < original.height; y += 1) {
    enqueue(y * original.width);
    enqueue(y * original.width + original.width - 1);
  }
  while (queueStart < queueEnd) {
    const pixel = queue[queueStart];
    queueStart += 1;
    const x = pixel % original.width;
    const y = Math.floor(pixel / original.width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < original.width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - original.width);
    if (y + 1 < original.height) enqueue(pixel + original.width);
  }

  for (let pixel = 0; pixel < total; pixel += 1) {
    const index = pixel * 4;
    if (background[pixel]) {
      outputPixels.data[index] = 255;
      outputPixels.data[index + 1] = 255;
      outputPixels.data[index + 2] = 255;
      outputPixels.data[index + 3] = 255;
      continue;
    }
    const x = pixel % original.width;
    const y = Math.floor(pixel / original.width);
    let touchesBackground = false;
    for (let offsetY = -2; offsetY <= 2 && !touchesBackground; offsetY += 1) {
      const neighborY = y + offsetY;
      if (neighborY < 0 || neighborY >= original.height) continue;
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        const neighborX = x + offsetX;
        if (neighborX < 0 || neighborX >= original.width) continue;
        if (background[neighborY * original.width + neighborX]) {
          touchesBackground = true;
          break;
        }
      }
    }
    if (!touchesBackground) continue;
    outputPixels.data[index] = originalPixels.data[index];
    outputPixels.data[index + 1] = originalPixels.data[index + 1];
    outputPixels.data[index + 2] = originalPixels.data[index + 2];
    outputPixels.data[index + 3] = 255;
  }
  outputContext.putImageData(outputPixels, 0, 0);
  original.close();
  working.close();
  return canvasToBlob(outputCanvas);
}

async function assertProtectedEditIsLocal(
  baseImage: Blob,
  editedImage: Blob,
  regions: RemoveRegion[],
) {
  const protectedRegions = regions.filter(
    (region) => region.kind === 'watermark' && region.overlapsProtectedContent,
  );
  if (!protectedRegions.length) return;

  const [base, edited] = await Promise.all([
    createImageBitmap(baseImage),
    createImageBitmap(editedImage),
  ]);
  const baseCanvas = document.createElement('canvas');
  const editedCanvas = document.createElement('canvas');
  baseCanvas.width = editedCanvas.width = base.width;
  baseCanvas.height = editedCanvas.height = base.height;
  const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
  const editedContext = editedCanvas.getContext('2d', { willReadFrequently: true });
  if (!baseContext || !editedContext) {
    base.close();
    edited.close();
    throw new Error('제품 원본 보호 검사를 실행하지 못했습니다.');
  }
  baseContext.drawImage(base, 0, 0);
  editedContext.drawImage(edited, 0, 0, base.width, base.height);
  const basePixels = baseContext.getImageData(0, 0, base.width, base.height).data;
  const editedPixels = editedContext.getImageData(0, 0, base.width, base.height).data;

  try {
    for (const region of protectedRegions) {
      const bounds = regionPixelBounds(base.width, base.height, region.box);
      let samples = 0;
      let changed = 0;
      let baseContent = 0;
      let editedContent = 0;
      for (let y = bounds.top; y < bounds.bottom; y += 2) {
        for (let x = bounds.left; x < bounds.right; x += 2) {
          const index = (y * base.width + x) * 4;
          const redDelta = Math.abs(basePixels[index] - editedPixels[index]);
          const greenDelta = Math.abs(basePixels[index + 1] - editedPixels[index + 1]);
          const blueDelta = Math.abs(basePixels[index + 2] - editedPixels[index + 2]);
          const baseLuma =
            basePixels[index] * 0.299 +
            basePixels[index + 1] * 0.587 +
            basePixels[index + 2] * 0.114;
          const editedLuma =
            editedPixels[index] * 0.299 +
            editedPixels[index + 1] * 0.587 +
            editedPixels[index + 2] * 0.114;
          samples += 1;
          if (Math.max(redDelta, greenDelta, blueDelta) > 30) changed += 1;
          if (baseLuma < 242) baseContent += 1;
          if (editedLuma < 242) editedContent += 1;
        }
      }
      if (!samples) continue;
      const changedRatio = changed / samples;
      const baseContentRatio = baseContent / samples;
      const editedContentRatio = editedContent / samples;
      if (
        changedRatio > 0.78 ||
        (baseContentRatio > 0.28 && editedContentRatio < baseContentRatio * 0.55)
      ) {
        throw new PipelineError(
          'unsafe_product_change',
          'AI가 워터마크 뒤의 제품을 과도하게 변경해 결과를 저장하지 않았습니다.',
        );
      }
    }
  } finally {
    base.close();
    edited.close();
  }
}

type SizedImageSource = ImageBitmap | HTMLCanvasElement;

function unionBoundingBoxes(
  ...boxes: Array<BoundingBox | null>
): BoundingBox | null {
  const present = boxes.filter((box): box is BoundingBox => Boolean(box));
  if (!present.length) return null;
  const left = Math.min(...present.map(([x]) => x));
  const top = Math.min(...present.map(([, y]) => y));
  const right = Math.max(...present.map(([x, , width]) => x + width));
  const bottom = Math.max(...present.map(([, y, , height]) => y + height));
  return [left, top, right - left, bottom - top];
}

function boundingBoxesOverlap(
  first: BoundingBox,
  second: BoundingBox | null,
) {
  if (!second) return false;
  return !(
    first[0] + first[2] <= second[0] ||
    second[0] + second[2] <= first[0] ||
    first[1] + first[3] <= second[1] ||
    second[1] + second[3] <= first[1]
  );
}

function imageWithoutRegions(
  bitmap: ImageBitmap,
  regions: Array<BoundingBox | null>,
) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('제품 영역을 분리하지 못했습니다.');
  context.drawImage(bitmap, 0, 0);
  context.fillStyle = '#ffffff';
  for (const region of regions) {
    if (!region) continue;
    const bounds = regionPixelBounds(canvas.width, canvas.height, region);
    const padding = 6;
    context.fillRect(
      Math.max(0, bounds.left - padding),
      Math.max(0, bounds.top - padding),
      Math.min(canvas.width, bounds.right + padding) -
        Math.max(0, bounds.left - padding),
      Math.min(canvas.height, bounds.bottom + padding) -
        Math.max(0, bounds.top - padding),
    );
  }
  return canvas;
}

function normalizedRect(
  bitmap: SizedImageSource,
  box: BoundingBox | null,
  padding = 10,
) {
  const normalized = box ?? ([0, 0, 1000, 1000] as BoundingBox);
  const [x, y, width, height] = normalized;
  const left = Math.max(0, ((x - padding) / 1000) * bitmap.width);
  const top = Math.max(0, ((y - padding) / 1000) * bitmap.height);
  const right = Math.min(
    bitmap.width,
    ((x + width + padding) / 1000) * bitmap.width,
  );
  const bottom = Math.min(
    bitmap.height,
    ((y + height + padding) / 1000) * bitmap.height,
  );
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function cleanedCrop(
  bitmap: SizedImageSource,
  box: BoundingBox | null,
  padding = 10,
  trimBackground = false,
) {
  const source = normalizedRect(bitmap, box, padding);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(source.width);
  canvas.height = Math.ceil(source.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이미지 영역을 준비하지 못했습니다.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const total = canvas.width * canvas.height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let queueStart = 0;
  let queueEnd = 0;
  const isBackground = (pixel: number) => {
    const index = pixel * 4;
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];
    const min = Math.min(red, green, blue);
    const max = Math.max(red, green, blue);
    const average = (red + green + blue) / 3;
    return min >= 238 || (max - min <= 14 && average >= 220);
  };
  const enqueue = (pixel: number) => {
    if (visited[pixel] || !isBackground(pixel)) return;
    visited[pixel] = 1;
    queue[queueEnd] = pixel;
    queueEnd += 1;
  };
  for (let x = 0; x < canvas.width; x += 1) {
    enqueue(x);
    enqueue((canvas.height - 1) * canvas.width + x);
  }
  for (let y = 0; y < canvas.height; y += 1) {
    enqueue(y * canvas.width);
    enqueue(y * canvas.width + canvas.width - 1);
  }
  while (queueStart < queueEnd) {
    const pixel = queue[queueStart];
    queueStart += 1;
    const x = pixel % canvas.width;
    const y = Math.floor(pixel / canvas.width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < canvas.width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - canvas.width);
    if (y + 1 < canvas.height) enqueue(pixel + canvas.width);
  }
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (!visited[pixel]) continue;
    const index = pixel * 4;
    pixels.data[index] = 255;
    pixels.data[index + 1] = 255;
    pixels.data[index + 2] = 255;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  if (trimBackground) {
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
        if (
          pixels.data[index] >= 250 &&
          pixels.data[index + 1] >= 250 &&
          pixels.data[index + 2] >= 250
        ) {
          continue;
        }
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right >= left && bottom >= top) {
      const trimPadding = 5;
      const trimLeft = Math.max(0, left - trimPadding);
      const trimTop = Math.max(0, top - trimPadding);
      const trimRight = Math.min(canvas.width, right + trimPadding + 1);
      const trimBottom = Math.min(canvas.height, bottom + trimPadding + 1);
      const trimmed = document.createElement('canvas');
      trimmed.width = trimRight - trimLeft;
      trimmed.height = trimBottom - trimTop;
      const trimmedContext = trimmed.getContext('2d');
      if (!trimmedContext) throw new Error('제품 여백을 정리하지 못했습니다.');
      trimmedContext.drawImage(
        canvas,
        trimLeft,
        trimTop,
        trimmed.width,
        trimmed.height,
        0,
        0,
        trimmed.width,
        trimmed.height,
      );
      return {
        canvas: trimmed,
        source: {
          x: source.x + trimLeft,
          y: source.y + trimTop,
          width: trimmed.width,
          height: trimmed.height,
        },
      };
    }
  }
  return { canvas, source };
}

type DrawMapping = {
  destination: { x: number; y: number; width: number; height: number };
  source: { x: number; y: number; width: number; height: number };
  scale: number;
};

function drawFittedRegion(
  context: CanvasRenderingContext2D,
  bitmap: SizedImageSource,
  box: BoundingBox | null,
  area: { x: number; y: number; width: number; height: number },
  padding = 10,
  trimBackground = false,
): DrawMapping {
  const crop = cleanedCrop(bitmap, box, padding, trimBackground);
  const scale = Math.min(
    area.width / crop.canvas.width,
    area.height / crop.canvas.height,
  );
  const width = crop.canvas.width * scale;
  const height = crop.canvas.height * scale;
  const x = area.x + (area.width - width) / 2;
  const y = area.y + (area.height - height) / 2;
  context.drawImage(crop.canvas, x, y, width, height);
  return {
    destination: { x, y, width, height },
    source: crop.source,
    scale,
  };
}

function overlayOriginalRegion(
  context: CanvasRenderingContext2D,
  original: ImageBitmap,
  region: BoundingBox | null,
  mapping: DrawMapping,
) {
  if (!region) return;
  const source = normalizedRect(original, region, 2);
  const x =
    mapping.destination.x + (source.x - mapping.source.x) * mapping.scale;
  const y =
    mapping.destination.y + (source.y - mapping.source.y) * mapping.scale;
  context.drawImage(
    original,
    source.x,
    source.y,
    source.width,
    source.height,
    x,
    y,
    source.width * mapping.scale,
    source.height * mapping.scale,
  );
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  referenceWidth: number,
) {
  const fontSize = Math.max(24, Math.min(36, referenceWidth * 0.055));
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  context.lineWidth = 2;
  context.strokeStyle = 'rgba(35, 39, 42, 0.18)';
  context.fillStyle = 'rgba(255, 255, 255, 0.62)';
  context.shadowColor = 'rgba(20, 24, 27, 0.18)';
  context.shadowBlur = 3;
  context.strokeText('KOREA AUTOPARTS', centerX, centerY);
  context.fillText('KOREA AUTOPARTS', centerX, centerY);
  context.restore();
}

async function composeFinal(
  originalSource: Blob,
  workingSource: Blob,
  analysis: ImageAnalysis,
  mode: ResolvedMode,
) {
  const [original, working] = await Promise.all([
    createImageBitmap(originalSource),
    createImageBitmap(workingSource),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1000;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    original.close();
    working.close();
    throw new Error('최종 이미지를 만들지 못했습니다.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 1000, 1000);
  const labelSetBox = unionBoundingBoxes(
    analysis.standaloneLabelBox,
    analysis.hologramBox,
  );
  const productSource =
    mode !== 'box'
      ? imageWithoutRegions(working, [
          analysis.standaloneLabelBox,
          analysis.hologramBox,
        ])
      : working;

  if (mode === 'label') {
    if (!labelSetBox) {
      const mapping = drawFittedRegion(
        context,
        productSource,
        analysis.contentBox ?? analysis.productBox,
        { x: 70, y: 70, width: 860, height: 860 },
        150,
        true,
      );
      drawWatermark(
        context,
        mapping.destination.x + mapping.destination.width / 2,
        mapping.destination.y + mapping.destination.height / 2,
        mapping.destination.width,
      );
      original.close();
      working.close();
      return canvasToBlob(canvas);
    }
    const labelMapping = drawFittedRegion(
      context,
      original,
      labelSetBox,
      { x: 220, y: 20, width: 560, height: 220 },
      14,
    );
    const productTop = Math.max(
      250,
      labelMapping.destination.y + labelMapping.destination.height + 18,
    );
    const productMapping = drawFittedRegion(
      context,
      productSource,
      analysis.productBox ?? analysis.contentBox,
      { x: 55, y: productTop, width: 890, height: 960 - productTop },
      150,
      true,
    );
    drawWatermark(
      context,
      productMapping.destination.x + productMapping.destination.width / 2,
      productMapping.destination.y + productMapping.destination.height / 2,
      productMapping.destination.width,
    );
  } else if (mode === 'box') {
    const mapping = drawFittedRegion(
      context,
      working,
      analysis.contentBox ?? analysis.boxBox ?? analysis.productBox,
      { x: 80, y: 80, width: 840, height: 840 },
      70,
      true,
    );
    overlayOriginalRegion(
      context,
      original,
      analysis.attachedLabelBox,
      mapping,
    );
    drawWatermark(context, 500, 500, mapping.destination.width);
  } else {
    const mapping = drawFittedRegion(
      context,
      productSource,
      analysis.productBox ?? analysis.contentBox,
      { x: 70, y: 70, width: 860, height: 860 },
      150,
      true,
    );
    drawWatermark(
      context,
      mapping.destination.x + mapping.destination.width / 2,
      mapping.destination.y + mapping.destination.height / 2,
      mapping.destination.width,
    );
  }

  original.close();
  working.close();
  return canvasToBlob(canvas);
}

export async function processUploadedImage({
  file,
  requestedMode,
  fallbackPartNumber,
  previousPartNumbers = [],
}: {
  file: File;
  requestedMode: WorkMode;
  fallbackPartNumber: string;
  previousPartNumbers?: string[];
}): Promise<ProcessedImage> {
  const prepared = await prepareSquareSource(file);
  let aiConnected = true;
  let aiEdited = false;
  let watermarkAuditCompleted = false;
  let watermarkVerified = false;
  let analysis: ImageAnalysis;
  const reviewReasons: string[] = [];

  try {
    analysis = await callAnalysis(prepared);
  } catch (error) {
    if (error instanceof PipelineError && error.code === 'api_key_missing') {
      aiConnected = false;
    }
    throw error instanceof Error
      ? error
      : new Error('AI 이미지 분석에 실패했습니다.');
  }

  if (aiConnected) {
    try {
      const watermarkAudit = await callAnalysis(prepared, 'watermark');
      const auditedWatermarks = watermarkAudit.removeRegions.filter(
        (region) => region.kind === 'watermark',
      );
      watermarkAuditCompleted = true;
      analysis = {
        ...analysis,
        hasOriginalWatermark:
          analysis.hasOriginalWatermark || watermarkAudit.hasOriginalWatermark,
        removeRegions: [...analysis.removeRegions, ...auditedWatermarks],
      };
      if (
        watermarkAudit.hasOriginalWatermark &&
        !auditedWatermarks.length &&
        !analysis.removeRegions.some((region) => region.kind === 'watermark')
      ) {
        reviewReasons.push('기존 워터마크의 정확한 제거 범위를 찾지 못했습니다.');
      }
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `기존 워터마크 정밀 검사 실패: ${error.message}`
          : '기존 워터마크 정밀 검사에 실패했습니다.',
      );
    }
  }

  const detectedPart =
    analysis.partNumber && analysis.partNumberConfidence >= 0.72
      ? analysis.partNumber
      : null;
  const filePart = partNumberFromFileName(file.name);
  const fallbackPart = normalizePartNumber(fallbackPartNumber);
  const partNumber = detectedPart ?? filePart ?? fallbackPart;
  let mode = requestedMode === 'auto' ? analysis.mode : requestedMode;
  if (
    requestedMode === 'auto' &&
    partNumber &&
    previousPartNumbers.includes(partNumber) &&
    analysis.hasStandaloneLabel &&
    analysis.hasProduct
  ) {
    mode = 'product';
  }

  if (
    detectedPart &&
    (filePart ?? fallbackPart) &&
    detectedPart !== (filePart ?? fallbackPart)
  ) {
    reviewReasons.push('사진의 품번과 파일·입력 품번이 서로 다릅니다.');
  }
  if (!partNumber) reviewReasons.push('파츠넘버를 확인해야 합니다.');
  if (analysis.partNumberConfidence > 0 && analysis.partNumberConfidence < 0.82) {
    reviewReasons.push('파츠넘버 인식 신뢰도가 낮습니다.');
  }
  if (analysis.modeConfidence < 0.75 && requestedMode === 'auto') {
    reviewReasons.push('사진 분류를 확인해야 합니다.');
  }
  if (mode === 'label' && !analysis.standaloneLabelBox) {
    reviewReasons.push('독립 라벨과 홀로그램 영역을 확인해야 합니다.');
  }

  let working = prepared;
  const removalRegions = analysis.removeRegions;
  if (
    analysis.hasOriginalWatermark &&
    !removalRegions.some((region) => region.kind === 'watermark')
  ) {
    throw new Error(
      '기존 워터마크의 제거 범위를 찾지 못해 작업을 중단했습니다.',
    );
  }
  if (aiConnected && removalRegions.length) {
    try {
      const mask = await createEditMask(prepared, removalRegions);
      const edited = await callImageEdit(prepared, mask, mode);
      working = await mergeEditedRegions(prepared, edited, removalRegions);
      aiEdited = true;
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error('AI 이미지 편집에 실패했습니다.');
    }
  }

  if (aiConnected && analysis.hasOriginalWatermark) {
    try {
      let watermarkCheck = await callAnalysis(working, 'watermark');
      const residualWatermarks = watermarkCheck.removeRegions.filter(
        (region) => region.kind === 'watermark',
      );

      if (watermarkCheck.hasOriginalWatermark && residualWatermarks.length) {
        const retryMask = await createEditMask(working, residualWatermarks);
        const retryEdit = await callImageEdit(working, retryMask, mode);
        working = await mergeEditedRegions(
          working,
          retryEdit,
          residualWatermarks,
        );
        aiEdited = true;
        watermarkCheck = await callAnalysis(working, 'watermark');
      }

      watermarkVerified = !watermarkCheck.hasOriginalWatermark;
      if (!watermarkVerified) {
        reviewReasons.push('기존 워터마크가 남아 있을 수 있습니다.');
      }
    } catch (error) {
      watermarkVerified = false;
      reviewReasons.push(
        error instanceof Error
          ? `기존 워터마크 제거 확인 실패: ${error.message}`
          : '기존 워터마크 제거 결과를 확인하지 못했습니다.',
      );
    }
  } else if (watermarkAuditCompleted && !analysis.hasOriginalWatermark) {
    watermarkVerified = true;
  }

  if (analysis.needsReview) {
    reviewReasons.push(...analysis.reviewReasons);
  }
  const uniqueReasons = [...new Set(reviewReasons.filter(Boolean))];
  const result = await composeFinal(prepared, working, analysis, mode);
  return {
    analysis,
    mode,
    partNumber,
    result,
    reviewReasons: uniqueReasons,
    aiConnected,
    aiEdited,
    watermarkVerified,
  };
}

export async function processGuidedImage({
  file,
  mode,
  fallbackPartNumber,
}: {
  file: File;
  mode: ResolvedMode;
  fallbackPartNumber: string;
}): Promise<ProcessedImage> {
  const prepared = await prepareSquareSource(file);
  const analysis = await callAnalysis(prepared);
  const detectedPart =
    analysis.partNumber && analysis.partNumberConfidence >= 0.72
      ? analysis.partNumber
      : null;
  const partNumber =
    detectedPart ??
    partNumberFromFileName(file.name) ??
    normalizePartNumber(fallbackPartNumber);
  const reviewReasons: string[] = [];

  if (!partNumber) reviewReasons.push('파츠넘버를 확인해야 합니다.');
  if (analysis.partNumberConfidence > 0 && analysis.partNumberConfidence < 0.82) {
    reviewReasons.push('파츠넘버 인식 결과를 확인해 주세요.');
  }
  if (analysis.mode !== mode && analysis.modeConfidence >= 0.82) {
    reviewReasons.push(
      `선택한 ${mode === 'label' ? '라벨형' : mode === 'box' ? '박스형' : '제품만'}과 자동 분석 결과가 다릅니다.`,
    );
  }
  if (mode === 'label' && (!analysis.productBox || !analysis.standaloneLabelBox)) {
    throw new PipelineError(
      'required_region_missing',
      '제품 또는 라벨 위치를 자동으로 찾지 못했습니다.',
    );
  }
  if (mode === 'box' && !(analysis.contentBox || analysis.boxBox)) {
    throw new PipelineError(
      'required_region_missing',
      '제품과 박스의 전체 위치를 자동으로 찾지 못했습니다.',
    );
  }
  if (mode === 'product' && !(analysis.productBox || analysis.contentBox)) {
    throw new PipelineError(
      'required_region_missing',
      '제품 위치를 자동으로 찾지 못했습니다.',
    );
  }

  const protectedContent = [
    analysis.productBox,
    analysis.boxBox,
    analysis.contentBox,
    analysis.attachedLabelBox,
  ];
  const watermarkRegions = analysis.removeRegions
    .filter((region) => region.kind === 'watermark')
    .map((region) => ({
      ...region,
      overlapsProtectedContent:
        region.overlapsProtectedContent ||
        protectedContent.some((box) => boundingBoxesOverlap(region.box, box)),
    }));
  if (analysis.hasOriginalWatermark && !watermarkRegions.length) {
    throw new PipelineError(
      'watermark_region_missing',
      '기존 워터마크 위치를 정확히 찾지 못했습니다.',
    );
  }

  let working = prepared;
  let aiEdited = false;
  if (watermarkRegions.length) {
    const mask = await createEditMask(prepared, watermarkRegions);
    const edited = await callImageEdit(prepared, mask, mode);
    await assertProtectedEditIsLocal(prepared, edited, watermarkRegions);
    working = await mergeEditedRegions(prepared, edited, watermarkRegions);
    aiEdited = true;
  }

  working = await preserveOriginalSilhouette(prepared, working);

  if (analysis.needsReview) reviewReasons.push(...analysis.reviewReasons);
  const result = await composeFinal(prepared, working, analysis, mode);
  return {
    analysis,
    mode,
    partNumber,
    result,
    reviewReasons: [...new Set(reviewReasons.filter(Boolean))],
    aiConnected: true,
    aiEdited,
    watermarkVerified: !analysis.hasOriginalWatermark || aiEdited,
  };
}

async function applyWhiteoutRegions(image: Blob, boxes: BoundingBox[]) {
  if (!boxes.length) return image;
  const bitmap = await createImageBitmap(image);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('흰색 정리 영역을 적용하지 못했습니다.');
  }
  context.drawImage(bitmap, 0, 0);
  context.fillStyle = '#ffffff';
  for (const box of boxes) {
    const bounds = regionPixelBounds(canvas.width, canvas.height, box);
    context.fillRect(
      bounds.left,
      bounds.top,
      bounds.right - bounds.left,
      bounds.bottom - bounds.top,
    );
  }
  bitmap.close();
  return canvasToBlob(canvas);
}

function manualAnalysis(mode: ResolvedMode, regions: ManualRegions) {
  const contentBox =
    mode === 'box' ? regions.contentBox : regions.productBox;
  return {
    partNumber: null,
    partNumberConfidence: 1,
    mode,
    modeConfidence: 1,
    hasProduct: Boolean(regions.productBox || regions.contentBox),
    hasBox: mode === 'box',
    hasStandaloneLabel: mode === 'label' && Boolean(regions.labelBox),
    hasHologram: mode === 'label' && Boolean(regions.hologramBox),
    attachedBoxLabelPresent: mode === 'box' && Boolean(regions.labelBox),
    hasOriginalWatermark: regions.watermarkBoxes.length > 0,
    hasShadowOrDirtyBackground: regions.whiteoutBoxes.length > 0,
    backgroundIsPureWhite: true,
    productBox: regions.productBox,
    boxBox: mode === 'box' ? regions.contentBox : null,
    standaloneLabelBox: mode === 'label' ? regions.labelBox : null,
    hologramBox: mode === 'label' ? regions.hologramBox : null,
    attachedLabelBox: mode === 'box' ? regions.labelBox : null,
    contentBox,
    removeRegions: regions.watermarkBoxes.map((box) => ({
      kind: 'watermark' as const,
      box,
      overlapsProtectedContent: true,
    })),
    needsReview: false,
    reviewReasons: [],
  } satisfies ImageAnalysis;
}

export async function processManualImage({
  file,
  mode,
  regions,
}: {
  file: File;
  mode: ResolvedMode;
  regions: ManualRegions;
}): Promise<ManualProcessedImage> {
  if (mode === 'label' && (!regions.productBox || !regions.labelBox)) {
    throw new Error('제품과 라벨 영역을 모두 지정해 주세요.');
  }
  if (mode === 'box' && !regions.contentBox) {
    throw new Error('제품과 박스를 포함한 전체 영역을 지정해 주세요.');
  }
  if (mode === 'product' && !regions.productBox) {
    throw new Error('제품 영역을 지정해 주세요.');
  }

  const prepared = await prepareSquareSource(file);
  let working = await applyWhiteoutRegions(prepared, regions.whiteoutBoxes);
  let aiEdited = false;

  if (regions.watermarkBoxes.length) {
    const removalRegions: RemoveRegion[] = regions.watermarkBoxes.map((box) => ({
      kind: 'watermark',
      box,
      overlapsProtectedContent: true,
    }));
    const mask = await createEditMask(working, removalRegions);
    const edited = await callImageEdit(working, mask, mode);
    working = await mergeEditedRegions(working, edited, removalRegions);
    aiEdited = true;
  }

  const result = await composeFinal(
    prepared,
    working,
    manualAnalysis(mode, regions),
    mode,
  );
  return { result, aiEdited };
}
