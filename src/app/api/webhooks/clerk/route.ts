import { db } from "@/server/db";
import { WebhookEvent } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { Webhook } from "svix";

export async function POST(req: Request) {
  // Get the headers
  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // If there are no svix headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error: Missing svix headers", { status: 400 });
  }

  // Get the body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Create a new Svix instance with your webhook secret
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return new Response("Error: Missing CLERK_WEBHOOK_SECRET", { status: 500 });
  }

  // Verify the webhook
  let event: WebhookEvent;
  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    event = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return new Response("Error verifying webhook", { status: 400 });
  }

  // Handle the webhook
  const eventType = event.type;
  console.log(`Webhook received: ${eventType}`);

  if (eventType === "user.created" || eventType === "user.updated") {
    const { id, email_addresses, first_name, last_name, image_url } =
      event.data;

    // Make sure we have valid data
    if (!id || !email_addresses || email_addresses.length === 0) {
      console.error("Invalid user data in webhook", event.data);
      return new Response("Error: Invalid user data", { status: 400 });
    }

    const emailAddress = email_addresses[0].email_address;

    try {
      await db.user.upsert({
        where: { id },
        update: {
          emailAddress,
          firstName: first_name || null,
          lastName: last_name || null,
          imageUrl: image_url || null,
        },
        create: {
          id,
          emailAddress,
          firstName: first_name || null,
          lastName: last_name || null,
          imageUrl: image_url || null,
        },
      });
      console.log(`User ${id} upserted successfully`);
    } catch (error) {
      console.error("Error upserting user:", error);
      return new Response("Error upserting user", { status: 500 });
    }
  }

  return new Response("Webhook processed successfully", { status: 200 });
}
