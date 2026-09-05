import { EDIT_INSTRUCTIONS } from '../../../lib/production-rules';

type ImageApiOutput = {
  error?: { code?: string; message?: string };
  data?: Array<{ b64_json?: string }>;
};

function imageQuality() {
  const configured = process.env.OPENAI_IMAGE_QUALITY;
  return configured === 'low' || configured === 'medium' || configured === 'high'
    ? configured
    : 'high';
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        code: 'api_key_missing',
        message: 'OpenAI API 키 연결이 필요합니다.',
      },
      { status: 503 },
    );
  }

  let input: FormData;
  try {
    input = await request.formData();
  } catch {
    return Response.json(
      {
        code: 'edit_payload_too_large',
        message: 'AI 편집용 이미지 전송 용량이 너무 큽니다.',
      },
      { status: 413 },
    );
  }
  const image = input.get('image');
  const mask = input.get('mask');
  const mode = String(input.get('mode') ?? 'product');
  if (
    !(image instanceof File) ||
    !image.type.startsWith('image/') ||
    !(mask instanceof File) ||
    !mask.type.startsWith('image/')
  ) {
    return Response.json(
      {
        code: 'invalid_edit',
        message: '편집할 이미지와 마스크가 필요합니다.',
      },
      { status: 400 },
    );
  }
  if (image.size > 20 * 1024 * 1024 || mask.size > 20 * 1024 * 1024) {
    return Response.json(
      {
        code: 'image_too_large',
        message: '이미지와 마스크는 각각 20MB 이하여야 합니다.',
      },
      { status: 413 },
    );
  }

  const form = new FormData();
  form.append('model', process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2');
  form.append('image[]', image, 'source.png');
  form.append('mask', mask, 'mask.png');
  form.append(
    'prompt',
    `${EDIT_INSTRUCTIONS}\nThe final workflow mode is: ${mode}.`,
  );
  form.append('quality', imageQuality());
  form.append('size', '1024x1024');
  form.append('output_format', 'png');

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    return Response.json(
      {
        code: 'openai_network_error',
        message: '서버가 OpenAI 이미지 편집 API에 연결하지 못했습니다.',
      },
      { status: 502 },
    );
  }
  const responseText = await response.text();
  let result: ImageApiOutput;
  try {
    result = JSON.parse(responseText) as ImageApiOutput;
  } catch {
    return Response.json(
      {
        code:
          response.status === 413
            ? 'openai_payload_too_large'
            : 'invalid_openai_image_response',
        message:
          response.status === 413
            ? 'OpenAI로 전송한 편집 이미지 용량이 너무 큽니다.'
            : 'OpenAI 이미지 편집 서버가 올바르지 않은 응답을 보냈습니다.',
      },
      { status: response.ok ? 502 : response.status },
    );
  }
  if (!response.ok) {
    return Response.json(
      {
        code: result.error?.code ?? 'image_edit_failed',
        message: result.error?.message ?? 'AI 이미지 편집에 실패했습니다.',
      },
      { status: response.status },
    );
  }

  const base64 = result.data?.[0]?.b64_json;
  if (!base64) {
    return Response.json(
      {
        code: 'empty_image_edit',
        message: 'AI 이미지 편집 결과가 비어 있습니다.',
      },
      { status: 502 },
    );
  }

  return Response.json({ image: `data:image/png;base64,${base64}` });
}
