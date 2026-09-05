type ModelLookup = {
  error?: {
    code?: string;
    message?: string;
  };
};

function configuredImageQuality() {
  const quality = process.env.OPENAI_IMAGE_QUALITY;
  return quality === 'low' || quality === 'medium' || quality === 'high'
    ? quality
    : 'high';
}

function connectionMessage(status: number, model: string, fallback?: string) {
  if (status === 401) return '저장된 OpenAI API 키가 유효하지 않습니다.';
  if (status === 403) return 'OpenAI API 키에 모델 사용 권한이 없습니다.';
  if (status === 404) return `설정된 AI 모델을 사용할 수 없습니다: ${model}`;
  if (status === 429) {
    return 'OpenAI API 사용 한도 또는 크레딧을 확인해 주세요.';
  }
  return fallback ?? 'OpenAI API 연결 상태를 확인하지 못했습니다.';
}

async function verifyModel(apiKey: string, model: string) {
  const response = await fetch(
    `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    },
  );
  const payload = (await response.json()) as ModelLookup;
  if (!response.ok) {
    return {
      ok: false as const,
      code: payload.error?.code ?? `http_${response.status}`,
      message: connectionMessage(
        response.status,
        model,
        payload.error?.message,
      ),
    };
  }
  return { ok: true as const };
}

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  const analysisModel = process.env.OPENAI_VISION_MODEL ?? 'gpt-5.4-mini';
  const imageModel = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
  const imageQuality = configuredImageQuality();

  if (!apiKey) {
    return Response.json({
      configured: false,
      connected: false,
      code: 'api_key_missing',
      message: 'OpenAI API 키를 저장해야 합니다.',
      analysisModel,
      imageModel,
      imageQuality,
      editMode: `ai-${imageQuality}`,
    });
  }

  try {
    const checks = await Promise.all([
      verifyModel(apiKey, analysisModel),
      verifyModel(apiKey, imageModel),
    ]);
    const failure = checks.find((check) => !check.ok);
    return Response.json({
      configured: true,
      connected: !failure,
      code: failure?.code,
      message: failure?.message,
      analysisModel,
      imageModel,
      imageQuality,
      editMode: `ai-${imageQuality}`,
    });
  } catch {
    return Response.json({
      configured: true,
      connected: false,
      code: 'openai_network_error',
      message:
        '서버가 OpenAI에 연결하지 못했습니다. 인터넷 연결 권한으로 서버를 다시 시작해야 합니다.',
      analysisModel,
      imageModel,
      imageQuality,
      editMode: `ai-${imageQuality}`,
    });
  }
}
