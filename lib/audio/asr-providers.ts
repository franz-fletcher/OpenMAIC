/**
 * ASR (Automatic Speech Recognition) Provider Implementation
 *
 * Factory pattern for routing ASR requests to appropriate provider implementations.
 * Follows the same architecture as lib/ai/providers.ts for consistency.
 *
 * Currently Supported Providers:
 * - OpenAI Whisper: https://platform.openai.com/docs/guides/speech-to-text
 * - Browser Native: Web Speech API (https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
 * - Qwen ASR: https://bailian.console.aliyun.com/
 *
 * HOW TO ADD A NEW PROVIDER:
 *
 * 1. Add provider ID to ASRProviderId in lib/audio/types.ts
 *    Example: | 'assemblyai-asr'
 *
 * 2. Add provider configuration to lib/audio/constants.ts
 *    Example:
 *    'assemblyai-asr': {
 *      id: 'assemblyai-asr',
 *      name: 'AssemblyAI',
 *      requiresApiKey: true,
 *      defaultBaseUrl: 'https://api.assemblyai.com/v2',
 *      icon: '/assemblyai.svg',
 *      supportedLanguages: ['en', 'es', 'fr', 'de', 'auto'],
 *      supportedFormats: ['mp3', 'wav', 'flac', 'm4a']
 *    }
 *
 * 3. Implement provider function in this file
 *    Pattern: async function transcribeXxxASR(config, audioBuffer): Promise<ASRTranscriptionResult>
 *    - Handle Buffer/Blob conversion (see helper patterns below)
 *    - Build API request with audio data (FormData or base64)
 *    - Handle API authentication (apiKey, headers)
 *    - Convert language codes if needed
 *    - Return { text: string }
 *
 *    Example:
 *    async function transcribeAssemblyAIASR(
 *      config: ASRModelConfig,
 *      audioBuffer: Buffer | Blob
 *    ): Promise<ASRTranscriptionResult> {
 *      const baseUrl = config.baseUrl || ASR_PROVIDERS['assemblyai-asr'].defaultBaseUrl;
 *
 *      // Step 1: Upload audio file
 *      let blob: Blob;
 *      if (audioBuffer instanceof Buffer) {
 *        blob = new Blob([audioBuffer.buffer.slice(
 *          audioBuffer.byteOffset,
 *          audioBuffer.byteOffset + audioBuffer.byteLength
 *        ) as ArrayBuffer], { type: 'audio/webm' });
 *      } else {
 *        blob = audioBuffer;
 *      }
 *
 *      const uploadResponse = await fetch(`${baseUrl}/upload`, {
 *        method: 'POST',
 *        headers: {
 *          'authorization': config.apiKey!,
 *        },
 *        body: blob,
 *      });
 *
 *      if (!uploadResponse.ok) {
 *        throw new Error(`AssemblyAI upload error: ${uploadResponse.statusText}`);
 *      }
 *
 *      const { upload_url } = await uploadResponse.json();
 *
 *      // Step 2: Request transcription
 *      const transcriptResponse = await fetch(`${baseUrl}/transcript`, {
 *        method: 'POST',
 *        headers: {
 *          'authorization': config.apiKey!,
 *          'Content-Type': 'application/json',
 *        },
 *        body: JSON.stringify({
 *          audio_url: upload_url,
 *          language_code: config.language === 'auto' ? undefined : config.language,
 *        }),
 *      });
 *
 *      const { id } = await transcriptResponse.json();
 *
 *      // Step 3: Poll for completion
 *      while (true) {
 *        const statusResponse = await fetch(`${baseUrl}/transcript/${id}`, {
 *          headers: { 'authorization': config.apiKey! },
 *        });
 *        const result = await statusResponse.json();
 *
 *        if (result.status === 'completed') {
 *          return { text: result.text || '' };
 *        } else if (result.status === 'error') {
 *          throw new Error(`AssemblyAI error: ${result.error}`);
 *        }
 *
 *        await new Promise(resolve => setTimeout(resolve, 1000));
 *      }
 *    }
 *
 * 4. Add case to transcribeAudio() switch statement
 *    case 'assemblyai-asr':
 *      return await transcribeAssemblyAIASR(config, audioBuffer);
 *
 * 5. Add i18n translations in lib/i18n.ts
 *    providerAssemblyAIASR: { zh: 'AssemblyAI 语音识别', en: 'AssemblyAI ASR' }
 *
 * Buffer/Blob Conversion Patterns:
 *
 * Pattern 1: Buffer to Blob (for FormData)
 *   const blob = new Blob([
 *     audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer
 *   ], { type: 'audio/webm' });
 *
 * Pattern 2: Buffer to base64 (for JSON API)
 *   let base64Audio: string;
 *   if (audioBuffer instanceof Buffer) {
 *     base64Audio = audioBuffer.toString('base64');
 *   } else {
 *     const arrayBuffer = await audioBuffer.arrayBuffer();
 *     base64Audio = Buffer.from(arrayBuffer).toString('base64');
 *   }
 *
 * Pattern 3: Buffer/Blob to File (for Vercel AI SDK)
 *   let audioFile: File;
 *   if (audioBuffer instanceof Buffer) {
 *     const arrayBuffer = audioBuffer.buffer.slice(...) as ArrayBuffer;
 *     const blob = new Blob([arrayBuffer], { type: 'audio/webm' });
 *     audioFile = new File([blob], 'audio.webm', { type: 'audio/webm' });
 *   } else {
 *     audioFile = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
 *   }
 *
 * Error Handling Patterns:
 * - Always validate API key if requiresApiKey is true
 * - Throw descriptive errors for API failures
 * - Include response.statusText or error messages from API
 * - For client-only providers (browser-native), throw error directing to client-side usage
 * - Handle polling/async APIs with proper timeout and error checking
 *
 * API Call Patterns:
 * - Vercel AI SDK: Use createOpenAI + transcribe (OpenAI, compatible providers)
 * - FormData: For providers expecting multipart/form-data (most providers)
 * - Base64: For providers expecting JSON with base64 audio (Qwen, DashScope)
 * - Upload + Poll: For async providers (AssemblyAI, Deepgram batch)
 */

import { createOpenAI } from '@ai-sdk/openai';
import { experimental_transcribe as transcribe } from 'ai';
import type { ASRModelConfig } from './types';
import { isCustomASRProvider } from './types';
import { ASR_PROVIDERS } from './constants';

/**
 * Result of ASR transcription
 */
export interface ASRTranscriptionResult {
  text: string;
}

/**
 * Transcribe audio using specified ASR provider
 */
export async function transcribeAudio(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const provider = ASR_PROVIDERS[config.providerId as keyof typeof ASR_PROVIDERS];

  // Validate API key if required (only for built-in providers with known config)
  if (provider?.requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for ASR provider: ${config.providerId}`);
  }

  switch (config.providerId) {
    case 'openai-whisper':
      return await transcribeOpenAIWhisper(config, audioBuffer);

    case 'browser-native':
      throw new Error('Browser Native ASR must be handled client-side using useBrowserASR hook');

    case 'qwen-asr':
      return await transcribeQwenASR(config, audioBuffer);

    case 'qwen-token-plan-asr':
      return await transcribeQwenTokenPlanASR(config, audioBuffer);

    case 'azure-asr':
      return await transcribeAzureASR(config, audioBuffer);

    case 'funasr-asr':
      return await transcribeWavOpenAICompatibleASR(config, audioBuffer, 'funasr-asr', 'FunASR');

    case 'lemonade-asr':
      return await transcribeWavOpenAICompatibleASR(
        config,
        audioBuffer,
        'lemonade-asr',
        'Lemonade',
      );

    default:
      if (isCustomASRProvider(config.providerId)) {
        return await transcribeOpenAIWhisper(config, audioBuffer);
      }
      throw new Error(`Unsupported ASR provider: ${config.providerId}`);
  }
}

/**
 * WAV-only OpenAI-compatible multipart transcription.
 *
 * Used by local providers whose transcription endpoint accepts WAV and JSON.
 */
async function transcribeWavOpenAICompatibleASR(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
  providerId: 'funasr-asr' | 'lemonade-asr',
  providerName: string,
): Promise<ASRTranscriptionResult> {
  const baseUrl = (config.baseUrl || ASR_PROVIDERS[providerId].defaultBaseUrl || '').replace(
    /\/$/,
    '',
  );

  const audioBlob = await toAudioBlob(audioBuffer);
  if (!(await isWavAudio(audioBlob))) {
    throw new Error(
      `${providerName} ASR currently supports WAV input only. Recordings should be converted to WAV before upload.`,
    );
  }

  const formData = new FormData();
  formData.set('file', audioBlob, 'audio.wav');
  formData.set('model', config.modelId || ASR_PROVIDERS[providerId].defaultModelId);
  formData.set('response_format', 'json');
  if (config.language && config.language !== 'auto') {
    formData.set('language', config.language);
  }

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: getOptionalBearerAuthHeaders(config.apiKey),
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (errorText.includes('audio is empty') || errorText.includes('too short')) {
      return { text: '' };
    }
    throw new Error(`${providerName} ASR API error: ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return { text: typeof data.text === 'string' ? data.text : '' };
}

async function toAudioBlob(audioBuffer: Buffer | Blob): Promise<Blob> {
  if (audioBuffer instanceof Blob) {
    return audioBuffer;
  }
  if (audioBuffer instanceof Buffer) {
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    ) as ArrayBuffer;
    return new Blob([arrayBuffer], { type: detectWavBuffer(audioBuffer) ? 'audio/wav' : '' });
  }
  throw new Error('Invalid audio buffer type');
}

async function isWavAudio(blob: Blob): Promise<boolean> {
  if (blob.type.includes('audio/wav') || blob.type.includes('audio/x-wav')) {
    return true;
  }

  if (blob instanceof File && /\.wav$/i.test(blob.name)) {
    return true;
  }

  const header = await blob.slice(0, 12).arrayBuffer();
  return detectWavBytes(new Uint8Array(header));
}

function detectWavBuffer(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  );
}

function detectWavBytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE'
  );
}

/**
 * Detect mp3 by ID3 tag or 0xFF sync byte.
 */
function detectMp3Bytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 3) return false;
  if (String.fromCharCode(...bytes.slice(0, 3)) === 'ID3') return true;
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true;
  return false;
}

/**
 * Detect Ogg container by the OggS magic.
 */
function detectOggBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  return String.fromCharCode(...bytes.slice(0, 4)) === 'OggS';
}

/**
 * Detect webm by the EBML magic number 0x1A45DFA3.
 */
function detectWebmBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/**
 * Derive the audio format from raw bytes.
 * Priority: webm (EBML) -> mp3 (ID3/0xFF) -> opus (OggS) -> wav (RIFF) -> wav fallback.
 */
function detectAudioFormat(bytes: Uint8Array): string {
  if (detectWebmBytes(bytes)) return 'webm';
  if (detectMp3Bytes(bytes)) return 'mp3';
  if (detectOggBytes(bytes)) return 'opus';
  if (detectWavBytes(bytes)) return 'wav';
  return 'wav';
}

/**
 * Read the sample rate from a WAV header (uint32 LE at offset 24).
 * Falls back to '48000' when the buffer is too short.
 */
function readWavSampleRate(bytes: Uint8Array): string {
  if (bytes.byteLength >= 28) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const rate = view.getUint32(24, true);
    if (rate > 0) return String(rate);
  }
  return '48000';
}

/**
 * Search for the OpusHead marker in webm bytes and read the sample rate
 * 12 bytes after it. Falls back to '48000' when not found.
 */
function readWebmOpusHeadRate(bytes: Uint8Array): string {
  const searchEnd = Math.min(bytes.byteLength - 16, 256);
  for (let i = 0; i < searchEnd; i++) {
    if (
      bytes[i] === 0x4f &&
      bytes[i + 1] === 0x70 &&
      bytes[i + 2] === 0x75 &&
      bytes[i + 3] === 0x73 &&
      bytes[i + 4] === 0x48 &&
      bytes[i + 5] === 0x65 &&
      bytes[i + 6] === 0x61 &&
      bytes[i + 7] === 0x64
    ) {
      const rateOffset = i + 12;
      if (rateOffset + 4 <= bytes.byteLength) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const rate = view.getUint32(rateOffset, true);
        if (rate > 0) return String(rate);
      }
      break;
    }
  }
  return '48000';
}

function getOptionalBearerAuthHeaders(apiKey?: string): Record<string, string> {
  const key = apiKey?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * OpenAI Whisper implementation (using Vercel AI SDK)
 */
async function transcribeOpenAIWhisper(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const openai = createOpenAI({
    apiKey: config.apiKey!,
    baseURL: config.baseUrl || ASR_PROVIDERS['openai-whisper'].defaultBaseUrl,
  });

  // Convert to Buffer or Uint8Array (which is required by the AI SDK)
  let audioData: Buffer | Uint8Array;
  if (audioBuffer instanceof Buffer) {
    audioData = audioBuffer;
  } else if (audioBuffer instanceof Blob) {
    const arrayBuffer = await audioBuffer.arrayBuffer();
    audioData = new Uint8Array(arrayBuffer);
  } else {
    throw new Error('Invalid audio buffer type');
  }

  try {
    const result = await transcribe({
      model: openai.transcription(config.modelId || ASR_PROVIDERS['openai-whisper'].defaultModelId),
      audio: audioData,
      providerOptions: {
        openai: {
          language: config.language === 'auto' ? undefined : config.language,
        },
      },
    });

    return { text: result.text || '' };
  } catch (error: unknown) {
    // Short/silent audio may cause the SDK to throw — treat as empty transcription
    const errMsg = error instanceof Error ? error.message : '';
    if (errMsg.includes('empty') || errMsg.includes('too short')) {
      return { text: '' };
    }
    throw error;
  }
}

/**
 * Qwen ASR implementation (DashScope API - Qwen3 ASR Flash)
 */
async function transcribeQwenASR(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const baseUrl = config.baseUrl || ASR_PROVIDERS['qwen-asr'].defaultBaseUrl;

  // Convert audio to base64
  let base64Audio: string;
  if (audioBuffer instanceof Buffer) {
    base64Audio = audioBuffer.toString('base64');
  } else if (audioBuffer instanceof Blob) {
    const arrayBuffer = await audioBuffer.arrayBuffer();
    base64Audio = Buffer.from(arrayBuffer).toString('base64');
  } else {
    throw new Error('Invalid audio buffer type');
  }

  // Build request body
  const requestBody: Record<string, unknown> = {
    model: config.modelId || ASR_PROVIDERS['qwen-asr'].defaultModelId,
    input: {
      messages: [
        {
          role: 'user',
          content: [
            {
              audio: `data:audio/wav;base64,${base64Audio}`,
            },
          ],
        },
      ],
    },
  };

  // Add language parameter in asr_options if specified (optional - improves accuracy for known languages)
  // If language is uncertain or mixed, don't specify (auto-detect)
  if (config.language && config.language !== 'auto') {
    requestBody.parameters = {
      asr_options: {
        language: config.language,
      },
    };
  }

  const response = await fetch(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-DashScope-Audio-Format': 'wav',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    // "The audio is empty" — treat as no speech detected
    if (errorText.includes('audio is empty') || errorText.includes('InvalidParameter')) {
      return { text: '' };
    }
    throw new Error(`Qwen ASR API error: ${errorText}`);
  }

  const data = await response.json();

  // Check for transcription result in response
  // Qwen3 ASR returns OpenAI-compatible format:
  // { output: { choices: [{ message: { content: [{ text: "transcribed text" }] } }] } }
  if (
    !data.output?.choices ||
    !Array.isArray(data.output.choices) ||
    data.output.choices.length === 0
  ) {
    throw new Error(`Qwen ASR error: No choices in response. Response: ${JSON.stringify(data)}`);
  }

  const firstChoice = data.output.choices[0];
  const messageContent = firstChoice?.message?.content;

  if (!Array.isArray(messageContent) || messageContent.length === 0) {
    // Empty content typically means audio was too short or contained no speech
    return { text: '' };
  }

  // Extract text from first content item
  const transcribedText = messageContent[0]?.text || '';
  return { text: transcribedText };
}

/**
 * Qwen Token Plan ASR (sync HTTP).
 *
 * Sends input_audio content with base64 data URI. Sends format and
 * sample_rate as strings. Parses top-level .text with documented
 * fallbacks. 400 with any body returns empty text. Other non-OK
 * statuses throw with status and response text.
 */
async function transcribeQwenTokenPlanASR(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const baseUrl = (
    config.baseUrl ||
    ASR_PROVIDERS['qwen-token-plan-asr'].defaultBaseUrl ||
    ''
  ).replace(/\/$/, '');

  // Convert to base64 and detect format + sample rate from raw bytes
  let base64Audio: string;
  let rawBytes: Uint8Array;

  if (audioBuffer instanceof Buffer) {
    base64Audio = audioBuffer.toString('base64');
    rawBytes = new Uint8Array(
      audioBuffer.buffer.slice(
        audioBuffer.byteOffset,
        audioBuffer.byteOffset + audioBuffer.byteLength,
      ) as ArrayBuffer,
    );
  } else if (audioBuffer instanceof Blob) {
    const arrayBuffer = await audioBuffer.arrayBuffer();
    rawBytes = new Uint8Array(arrayBuffer);
    base64Audio = Buffer.from(arrayBuffer).toString('base64');
  } else {
    throw new Error('Invalid audio buffer type');
  }

  const format = detectAudioFormat(rawBytes);
  let sampleRate: string;
  if (format === 'wav') {
    sampleRate = readWavSampleRate(rawBytes);
  } else if (format === 'webm') {
    sampleRate = readWebmOpusHeadRate(rawBytes);
  } else {
    sampleRate = '48000';
  }

  // Build the data URI with the correct MIME type
  const mimeMap: Record<string, string> = {
    wav: 'audio/wav',
    webm: 'audio/webm',
    mp3: 'audio/mpeg',
    opus: 'audio/ogg',
  };
  const mime = mimeMap[format] || 'audio/wav';
  const dataUri = `data:${mime};base64,${base64Audio}`;

  const requestBody: Record<string, unknown> = {
    model: config.modelId || ASR_PROVIDERS['qwen-token-plan-asr'].defaultModelId,
    input: {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: dataUri },
            },
          ],
        },
      ],
    },
    parameters: {
      format,
      sample_rate: sampleRate,
    },
  };

  const response = await fetch(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    if (response.status === 400) {
      return { text: '' };
    }
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Qwen Token Plan ASR error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Parse response with fallback chain
  const text = data.text || data.sentence?.text || data.output?.output?.sentence?.text || '';
  return { text };
}

/**
 * Azure STT implementation (Fast Transcription REST API)
 * https://learn.microsoft.com/azure/ai-services/speech-service/fast-transcription-create
 */
async function transcribeAzureASR(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const rawBaseUrl = config.baseUrl || ASR_PROVIDERS['azure-asr'].defaultBaseUrl!;

  if (!rawBaseUrl || rawBaseUrl.includes('{region}')) {
    throw new Error('Azure STT base URL must include a real region');
  }

  let endpoint = rawBaseUrl.replace(/\/+$/, '');
  if (/\.stt\.speech\.microsoft\.com$/i.test(endpoint)) {
    endpoint = endpoint.replace(/\.stt\.speech\.microsoft\.com$/i, '.api.cognitive.microsoft.com');
  }
  if (!/\/speechtotext\/transcriptions:transcribe/i.test(endpoint)) {
    endpoint = `${endpoint}/speechtotext/transcriptions:transcribe`;
  }
  const url = new URL(endpoint);
  if (!url.searchParams.get('api-version')) {
    url.searchParams.set('api-version', '2025-10-15');
  }

  let audioBlob: Blob;
  if (audioBuffer instanceof Blob) {
    audioBlob = audioBuffer;
  } else {
    audioBlob = new Blob([audioBuffer as unknown as BlobPart], { type: 'audio/webm' });
  }

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  const localeMap: Record<string, string> = {
    en: 'en-US',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    it: 'it-IT',
    pt: 'pt-BR',
    ru: 'ru-RU',
    ar: 'ar-SA',
    hi: 'hi-IN',
  };

  if (config.language && config.language !== 'auto') {
    const locale = localeMap[config.language] || config.language;
    formData.append('definition', JSON.stringify({ locales: [locale] }));
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': config.apiKey! },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Azure STT error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    combinedPhrases?: Array<{ text?: string }>;
    phrases?: Array<{ text?: string }>;
  };

  const combinedText = data.combinedPhrases
    ?.map((p) => p.text || '')
    .filter(Boolean)
    .join(' ');
  const phraseText = data.phrases
    ?.map((p) => p.text || '')
    .filter(Boolean)
    .join(' ');

  return { text: combinedText || phraseText || '' };
}

/**
 * Get current ASR configuration from settings store
 * Note: This function should only be called in browser context
 */
export async function getCurrentASRConfig(): Promise<ASRModelConfig> {
  if (typeof window === 'undefined') {
    throw new Error('getCurrentASRConfig() can only be called in browser context');
  }

  // Lazy import to avoid circular dependency
  const { useSettingsStore } = await import('@/lib/store/settings');
  const { asrProviderId, asrLanguage, asrProvidersConfig } = useSettingsStore.getState();

  const providerConfig = asrProvidersConfig?.[asrProviderId];

  return {
    providerId: asrProviderId,
    modelId:
      providerConfig?.modelId ||
      ASR_PROVIDERS[asrProviderId as keyof typeof ASR_PROVIDERS]?.defaultModelId ||
      '',
    apiKey: providerConfig?.apiKey,
    baseUrl: providerConfig?.baseUrl || providerConfig?.customDefaultBaseUrl,
    language: asrLanguage,
  };
}

// Re-export from constants for convenience
export { getAllASRProviders, getASRProvider, getASRSupportedLanguages } from './constants';
