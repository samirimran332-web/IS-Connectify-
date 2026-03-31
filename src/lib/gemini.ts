import { GoogleGenAI, ThinkingLevel, Modality, Type, GenerateContentResponse } from "@google/genai";

// The platform injects GEMINI_API_KEY into process.env
const defaultApiKey = process.env.GEMINI_API_KEY!;

export const APP_SYSTEM_INSTRUCTION = `You are "IS Connectify AI", a highly intelligent and versatile study assistant and creative companion. Your primary goal is to empower students and creators with knowledge, inspiration, and tools.

Core Identity & Tone:
- Name: IS Connectify AI.
- Personality: Encouraging, professional, insightful, and patient.
- Tone: Approachable and clear. Use analogies to explain complex topics.
- Language: You are fluent in both English and Bengali. If the user speaks in Bengali, respond in Bengali or a mix as appropriate.

Capabilities & Responsibilities:
1. Study Assistance: Provide detailed explanations, solve problems step-by-step, and offer study tips. Tailor your complexity to the student's class and department.
2. Creative Companion: You can help brainstorm prompts for images, videos, and music. You understand the "Media" section of the app generates visual and auditory content.
3. News & Information: You can summarize trending topics, especially those relevant to education and technology in Bangladesh.
4. Task & Time Management: Offer advice on organizing schedules and prioritizing tasks.
5. Collaborative Spirit: Encourage group study and knowledge sharing.

Guidelines:
- Accuracy: Always prioritize factual correctness. If unsure, admit it.
- Formatting: Use Markdown for clear structure (headings, lists, bold text, code blocks).
- Encouragement: End helpful explanations with a small encouraging remark.
- Safety: Adhere to safety guidelines. Do not generate harmful or inappropriate content.

Contextual Awareness:
- You are part of the "IS Connectify" ecosystem, which includes News, Study, Media, Tasks, and Groups.
- When helping with study, consider the student's specific academic background if provided.`;

export const getAI = (customKey?: string) => {
  return new GoogleGenAI({ apiKey: customKey || defaultApiKey });
};

export const MODELS = {
  PRO: "gemini-3.1-pro-preview",
  FLASH: "gemini-3-flash-preview",
  LITE: "gemini-3.1-flash-lite-preview",
  IMAGE: "gemini-2.5-flash-image",
  IMAGE_PRO: "gemini-3-pro-image-preview",
  VIDEO: "veo-3.1-fast-generate-preview",
  TTS: "gemini-2.5-flash-preview-tts",
  MUSIC_CLIP: "lyria-3-clip-preview",
  MUSIC_PRO: "lyria-3-pro-preview",
  LIVE: "gemini-3.1-flash-live-preview",
};

export async function generateStudyHelp(prompt: string, history: any[] = [], config: { customKey?: string, studentClass?: string, department?: string, files?: { data: string, mimeType: string }[] } = {}) {
  const ai = getAI(config.customKey);
  const chat = ai.chats.create({
    model: MODELS.PRO,
    config: {
      systemInstruction: `${APP_SYSTEM_INSTRUCTION}
      
      Current Student Context:
      - Class/Level: ${config.studentClass || 'Not specified'}
      - Department/Major: ${config.department || 'Not specified'}`,
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
    },
    history: history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.content }]
    }))
  });

  const parts: any[] = [{ text: prompt }];
  if (config.files && config.files.length > 0) {
    config.files.forEach(f => {
      parts.push({ inlineData: { data: f.data, mimeType: f.mimeType } });
    });
  }

  const response = await chat.sendMessage({ message: parts });
  return response.text;
}

export async function generateNews(topic: string, customKey?: string) {
  const ai = getAI(customKey);
  const response = await ai.models.generateContent({
    model: MODELS.FLASH,
    contents: `As IS Connectify AI, research and write a short, engaging news article in Bengali language about: ${topic}. 
    Focus on updates related to Bangladesh. Include a catchy title and well-structured content. 
    Ensure the tone is informative and professional, suitable for students.`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });
  return response.text;
}

export async function generateAutoNews(customKey?: string) {
  const ai = getAI(customKey);
  const response = await ai.models.generateContent({
    model: MODELS.FLASH,
    contents: `As IS Connectify AI, research and write a trending news article about Bangladesh in Bengali language. 
    Focus on current events, technology, or education updates within Bangladesh. 
    Make it unique, informative, and engaging for students. Include a clear title and content.`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });
  return response.text;
}

export async function generateImage(prompt: string, config: { 
  aspectRatio?: string, 
  imageSize?: string, 
  customKey?: string,
  style?: string,
  chaos?: number,
  stylize?: number
}) {
  const ai = getAI(config.customKey);
  const model = config.imageSize ? MODELS.IMAGE_PRO : MODELS.IMAGE;
  
  const imageConfig: any = {
    aspectRatio: config.aspectRatio || "1:1",
  };

  if (config.imageSize) {
    imageConfig.imageSize = config.imageSize;
    if (config.style) imageConfig.style = config.style;
    if (config.chaos !== undefined) imageConfig.chaos = config.chaos;
    if (config.stylize !== undefined) imageConfig.stylize = config.stylize;
  }

  const response = await ai.models.generateContent({
    model: model,
    contents: { parts: [{ text: prompt }] },
    config: {
      imageConfig: imageConfig
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No image generated");
}

export async function generateVideo(prompt: string, config: { aspectRatio?: "16:9" | "9:16", customKey?: string }) {
  const ai = getAI(config.customKey);
  let operation = await ai.models.generateVideos({
    model: MODELS.VIDEO,
    prompt: prompt,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: config.aspectRatio || '16:9'
    }
  });

  return operation;
}

export async function getVideoResult(downloadLink: string, customKey?: string) {
  const apiKey = customKey || defaultApiKey;
  const response = await fetch(downloadLink, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey,
    },
  });
  if (!response.ok) throw new Error("Failed to fetch video content");
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function pollVideoOperation(operation: any, customKey?: string, onProgress?: (op: any) => void) {
  const ai = getAI(customKey);
  let currentOp = operation;
  while (!currentOp.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    currentOp = await ai.operations.getVideosOperation({ operation: currentOp });
    if (onProgress) onProgress(currentOp);
  }
  return currentOp;
}

export async function generateMusic(prompt: string, isPro: boolean = false, customKey?: string) {
  const ai = getAI(customKey);
  const response = await ai.models.generateContentStream({
    model: isPro ? MODELS.MUSIC_PRO : MODELS.MUSIC_CLIP,
    contents: prompt,
  });

  let audioBase64 = "";
  let mimeType = "audio/wav";

  for await (const chunk of response) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (!audioBase64 && part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
        audioBase64 += part.inlineData.data;
      }
    }
  }

  if (!audioBase64) throw new Error("No audio generated");

  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}
