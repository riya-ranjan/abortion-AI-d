import { initObservability } from "@/app/observability";
import { Message, StreamData, StreamingTextResponse } from "ai";
import { ChatMessage, MessageContent, Settings } from "llamaindex";
import { NextRequest, NextResponse } from "next/server";
import { createChatEngine } from "./engine/chat";
import { initSettings } from "./engine/settings";
import { LlamaIndexStream } from "./llamaindex-stream";
import { createCallbackManager } from "./stream-helper";

initObservability();
initSettings();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYS = `
----------
INSTRUCTIONS: You are an assistant meant to help people find information about abortions. Please make sure to provide
strictly legal information that is accurate, and provide a comprehensive, readable list of information as a response. Make
sure that your answers are as long and complete as possible; feel free to use the internet, etc. to search for information.
You can provide responses that are not explicitly part of the provided context.

Make sure that you respond in a format like so:
User: I want an abortion.

Thank you for asking about abortion! 

You can get an abortion a multitude of ways.
1) Surgical abortion
- Surgical abortion involves ... 
2) Medical abortion
- Medical abortion involves ...
-----------------
User: `

const convertMessageContent = (
  textMessage: string,
  imageUrl: string | undefined,
): MessageContent => {
  if (!imageUrl) return textMessage;
  return [
    {
      type: "text",
      text: SYS + textMessage,
    },
    {
      type: "image_url",
      image_url: {
        url: imageUrl,
      },
    },
  ];
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, data }: { messages: Message[]; data: any } = body;
    const userMessage = messages.pop();
    if (!messages || !userMessage || userMessage.role !== "user") {
      return NextResponse.json(
        {
          error:
            "messages are required in the request body and the last message must be from the user",
        },
        { status: 400 },
      );
    }

    const chatEngine = await createChatEngine();

    // Convert message content from Vercel/AI format to LlamaIndex/OpenAI format
    const userMessageContent = convertMessageContent(
      userMessage.content,
      data?.imageUrl,
    );

    // Init Vercel AI StreamData
    const vercelStreamData = new StreamData();

    // Setup callbacks
    const callbackManager = createCallbackManager(vercelStreamData);

    // Calling LlamaIndex's ChatEngine to get a streamed response
    const response = await Settings.withCallbackManager(callbackManager, () => {
      return chatEngine.chat({
        message: userMessageContent,
        chatHistory: messages as ChatMessage[],
        stream: true,
      });
    });

    // Transform LlamaIndex stream to Vercel/AI format
    const stream = LlamaIndexStream(response, vercelStreamData, {
      parserOptions: {
        image_url: data?.imageUrl,
      },
    });

    // Return a StreamingTextResponse, which can be consumed by the Vercel/AI client
    return new StreamingTextResponse(stream, {}, vercelStreamData);
  } catch (error) {
    console.error("[LlamaIndex]", error);
    return NextResponse.json(
      {
        detail: (error as Error).message,
      },
      {
        status: 500,
      },
    );
  }
}
