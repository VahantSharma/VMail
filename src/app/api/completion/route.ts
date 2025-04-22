import { streamText } from "ai";
// import { openai } from '@ai-sdk/openai'; // Remove OpenAI import
import { google } from "@ai-sdk/google"; // Add Google import
// import { createStreamableValue } from 'ai/rsc'; // Likely not needed for basic streaming

// Keep Message interface or use CoreMessage from 'ai' if preferred
export interface Message {
  role: "user" | "assistant" | "system"; // Add system role
  content: string;
}

export async function POST(req: Request) {
  try {
    // extract the prompt from the body
    const { prompt } = await req.json();

    if (!prompt) {
      return new Response("Missing prompt", { status: 400 });
    }

    // Prepare messages for the AI SDK
    const messages: Message[] = [
      {
        role: "system",
        content: `You are a helpful AI embedded in a text editor app that is used to autocomplete sentences.
                The traits of AI include expert knowledge, helpfulness, cleverness, and articulateness.
                AI is a well-behaved and well-mannered individual.
                AI is always friendly, kind, and inspiring, and eager to provide vivid and thoughtful responses to the user.
                Keep the response short and directly continue the user's thought.`,
      },
      {
        role: "user",
        content: `Help me complete my train of thought here: ##${prompt}##`,
      },
    ];

    // Use Vercel AI SDK streamText with Google provider
    const result = await streamText({
      // Use a suitable Gemini model (e.g., flash for speed)
      model: google("models/gemini-2.0-flash"),
      messages: messages,
      // Add parameters if needed, e.g., maxTokens, temperature
      maxTokens: 50, // Limit completion length
      temperature: 0.7, // Control randomness
    });

    // Return the streaming response
    return result.toAIStreamResponse();
  } catch (error) {
    console.error("Error in /api/completion:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
