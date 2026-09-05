import {
  ANALYSIS_INSTRUCTIONS,
  WATERMARK_AUDIT_INSTRUCTIONS,
} from '../../../lib/production-rules';

const BOX_SCHEMA = {
  anyOf: [
    {
      type: 'array',
      items: { type: 'number', minimum: 0, maximum: 1000 },
      minItems: 4,
      maxItems: 4,
    },
    { type: 'null' },
  ],
} as const;

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    partNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    partNumberConfidence: { type: 'number', minimum: 0, maximum: 1 },
    mode: { type: 'string', enum: ['label', 'box', 'product'] },
    modeConfidence: { type: 'number', minimum: 0, maximum: 1 },
    hasProduct: { type: 'boolean' },
    hasBox: { type: 'boolean' },
    hasStandaloneLabel: { type: 'boolean' },
    hasHologram: { type: 'boolean' },
    attachedBoxLabelPresent: { type: 'boolean' },
    hasOriginalWatermark: { type: 'boolean' },
    hasShadowOrDirtyBackground: { type: 'boolean' },
    backgroundIsPureWhite: { type: 'boolean' },
    productBox: BOX_SCHEMA,
    boxBox: BOX_SCHEMA,
    standaloneLabelBox: BOX_SCHEMA,
    hologramBox: BOX_SCHEMA,
    attachedLabelBox: BOX_SCHEMA,
    contentBox: BOX_SCHEMA,
    removeRegions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string',
            enum: ['watermark', 'shadow', 'ui', 'badge', 'artifact'],
          },
          box: {
            type: 'array',
            items: { type: 'number', minimum: 0, maximum: 1000 },
            minItems: 4,
            maxItems: 4,
          },
          overlapsProtectedContent: { type: 'boolean' },
        },
        required: ['kind', 'box', 'overlapsProtectedContent'],
      },
    },
    needsReview: { type: 'boolean' },
    reviewReasons: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'partNumber',
    'partNumberConfidence',
    'mode',
    'modeConfidence',
    'hasProduct',
    'hasBox',
    'hasStandaloneLabel',
    'hasHologram',
    'attachedBoxLabelPresent',
    'hasOriginalWatermark',
    'hasShadowOrDirtyBackground',
    'backgroundIsPureWhite',
    'productBox',
    'boxBox',
    'standaloneLabelBox',
    'hologramBox',
    'attachedLabelBox',
    'contentBox',
    'removeRegions',
    'needsReview',
    'reviewReasons',
  ],
} as const;

type ApiOutput = {
  error?: { code?: string; message?: string };
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function normalizePartNumber(value: unknown) {
  if (typeof value !== 'string') return null;
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length < 6 || compact.length > 16) return null;
  return `${compact.slice(0, 5)}-${compact.slice(5)}`;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        code: 'api_key_missing',
        message: '이미지 분석 연결이 필요합니다.',
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      {
        code: 'analysis_payload_too_large',
        message: '검사용 이미지 전송 용량이 너무 큽니다.',
      },
      { status: 413 },
    );
  }
  const image = form.get('image');
  const focus = String(form.get('focus') ?? 'full');
  if (!(image instanceof File) || !image.type.startsWith('image/')) {
    return Response.json(
      { code: 'invalid_image', message: '이미지 파일이 필요합니다.' },
      { status: 400 },
    );
  }
  if (image.size > 20 * 1024 * 1024) {
    return Response.json(
      { code: 'image_too_large', message: '이미지는 20MB 이하여야 합니다.' },
      { status: 413 },
    );
  }

  const base64 = Buffer.from(await image.arrayBuffer()).toString('base64');
  const imageUrl = `data:${image.type};base64,${base64}`;
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL ?? 'gpt-5.4-mini',
        store: false,
        max_output_tokens: 2200,
        instructions:
          focus === 'watermark'
            ? WATERMARK_AUDIT_INSTRUCTIONS
            : ANALYSIS_INSTRUCTIONS,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text:
                  focus === 'watermark'
                    ? 'Audit the entire source image for every old third-party watermark and return exact removal regions.'
                    : 'Analyze this source photo for the automotive-parts image-production workflow.',
              },
              {
                type: 'input_image',
                image_url: imageUrl,
                detail: 'high',
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'autoparts_image_analysis',
            strict: true,
            schema: ANALYSIS_SCHEMA,
          },
        },
      }),
    });
  } catch {
    return Response.json(
      {
        code: 'openai_network_error',
        message: '서버가 OpenAI 이미지 분석 API에 연결하지 못했습니다.',
      },
      { status: 502 },
    );
  }

  const responseText = await response.text();
  let result: ApiOutput;
  try {
    result = JSON.parse(responseText) as ApiOutput;
  } catch {
    return Response.json(
      {
        code:
          response.status === 413
            ? 'openai_payload_too_large'
            : 'invalid_openai_analysis_response',
        message:
          response.status === 413
            ? 'OpenAI로 전송한 검사 이미지 용량이 너무 큽니다.'
            : 'OpenAI 이미지 분석 서버가 올바르지 않은 응답을 보냈습니다.',
      },
      { status: response.ok ? 502 : response.status },
    );
  }
  if (!response.ok) {
    return Response.json(
      {
        code: result.error?.code ?? 'analysis_failed',
        message: result.error?.message ?? '이미지 분석에 실패했습니다.',
      },
      { status: response.status },
    );
  }

  const outputText = result.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === 'output_text')?.text;
  if (!outputText) {
    return Response.json(
      { code: 'empty_analysis', message: '분석 결과가 비어 있습니다.' },
      { status: 502 },
    );
  }

  try {
    const analysis = JSON.parse(outputText) as Record<string, unknown>;
    analysis.partNumber = normalizePartNumber(analysis.partNumber);
    return Response.json({ analysis });
  } catch {
    return Response.json(
      { code: 'invalid_analysis', message: '분석 결과 형식이 올바르지 않습니다.' },
      { status: 502 },
    );
  }
}
