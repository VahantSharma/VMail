// Remove OpenAI specific imports
// import { Configuration, OpenAIApi } from "openai-edge";
// import { Message, OpenAIStream, StreamingTextResponse } from "ai";

// Add Vercel AI SDK imports for streaming and Google provider
import { google } from "@ai-sdk/google";
import type { CoreMessage } from "ai"; // Use CoreMessage type if needed
import { streamText } from "ai";

import { FREE_CREDITS_PER_DAY } from "@/app/constants";
import { OramaManager } from "@/lib/orama";
import { getSubscriptionStatus } from "@/lib/razorpay-actions";
import { db } from "@/server/db";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// export const runtime = "edge"; // Optional: Can often be used with Vercel AI SDK

// Remove OpenAI client setup
// const config = new Configuration({
//     apiKey: process.env.OPENAI_API_KEY,
// });
// const openai = new OpenAIApi(config);

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isSubscribed = await getSubscriptionStatus();
    if (!isSubscribed) {
      // Find or create today's interaction record
      const today = new Date().toDateString();
      let chatbotInteraction = await db.chatbotInteraction.findUnique({
        where: { day_userId: { day: today, userId } }, // Use combined unique index if defined
      });

      if (!chatbotInteraction) {
        chatbotInteraction = await db.chatbotInteraction.create({
          data: {
            day: today,
            count: 0, // Start count at 0 before the first request
            userId,
          },
        });
      }

      // Check limit before proceeding
      if (chatbotInteraction.count >= FREE_CREDITS_PER_DAY) {
        return NextResponse.json(
          { error: "Limit reached for today. Please upgrade to pro." },
          { status: 429 },
        );
      }
    }

    // Ensure messages is an array of CoreMessage
    const { messages: reqMessages, accountId } = (await req.json()) as {
      messages: CoreMessage[];
      accountId: string;
    };
    if (!Array.isArray(reqMessages)) {
      throw new Error("Invalid messages format");
    }

    const oramaManager = new OramaManager(accountId);
    await oramaManager.initialize();

    const lastMessage = reqMessages[reqMessages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      throw new Error("Last message must be from the user.");
    }

    const context = await oramaManager.vectorSearch({
      prompt: lastMessage.content as string,
    }); // Cast content to string
    console.log(context.hits.length + " hits found");

    // Adapt prompt for Gemini if needed, structure using CoreMessage format
    const systemPrompt: CoreMessage = {
      role: "system",
      content: `You are an AI email assistant embedded in an email client app. Your purpose is to help the user compose emails by answering questions, providing suggestions, and offering relevant information based on the context of their previous emails.
            THE TIME NOW IS ${new Date().toLocaleString()}

      START CONTEXT BLOCK
      ${context.hits.map((hit) => JSON.stringify(hit.document)).join("\n")}
      END OF CONTEXT BLOCK

      When responding, please keep in mind:
      - Be helpful, clever, and articulate.
      - Rely on the provided email context to inform your responses.
      - If the context does not contain enough information to answer a question, politely say you don't have enough information.
      - Avoid apologizing for previous responses. Instead, indicate that you have updated your knowledge based on new information.
      - Do not invent or speculate about anything that is not directly supported by the email context.
      - Keep your responses concise and relevant to the user's questions or the email being composed.`,
    };

    // Combine system prompt and user messages
    const messagesForApi: CoreMessage[] = [
      systemPrompt,
      ...reqMessages.filter(
        (message) => message.role === "user" || message.role === "assistant",
      ), // Include assistant messages for context
    ];

    // Use the Vercel AI SDK streamText function with the Google provider
    const result = await streamText({
      // Use a Gemini model (e.g., 1.5 Flash for speed/cost)
      // The SDK should automatically pick up GOOGLE_GENERATIVE_AI_API_KEY from env
      model: google("models/gemini-2.0-flash"),
      messages: messagesForApi, // Pass the combined messages array
      async onFinish(completion) {
        // Use onFinish for post-completion logic
        // Only increment if not subscribed
        if (!isSubscribed) {
          const today = new Date().toDateString();
          try {
            await db.chatbotInteraction.update({
              where: { day_userId: { day: today, userId } }, // Use combined unique index if defined
              data: {
                count: {
                  increment: 1,
                },
              },
            });
            console.log(
              `Incremented chat count for user ${userId} on ${today}`,
            );
          } catch (updateError) {
            console.error(
              `Failed to update chat count for user ${userId}:`,
              updateError,
            );
            // Decide how to handle this error - maybe log it but don't fail the request
          }
        }
      },
    });

    // Return the streaming response
    return result.toAIStreamResponse();
  } catch (error) {
    console.error("Error in /api/chat:", error); // Log the specific error
    // Check for specific error types if needed
    if (error instanceof Error && error.message.includes("Limit reached")) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    // Return a generic server error
    return NextResponse.json(
      { error: "An internal server error occurred." },
      { status: 500 },
    );
  }
}
