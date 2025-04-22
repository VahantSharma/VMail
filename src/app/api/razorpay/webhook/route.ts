import { env } from "@/env.js";
import { db } from "@/server/db";
import crypto from "crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

// Type definition for expected Razorpay webhook payload (adjust based on events you handle)
type RazorpayWebhookPayload = {
  event: string; // e.g., 'subscription.activated', 'payment.captured', 'subscription.charged'
  payload: {
    subscription?: {
      entity: Razorpay.Subscription;
    };
    payment?: {
      entity: Razorpay.Payment;
    };
    // Add other payload types as needed based on subscribed events
  };
};

export async function POST(req: Request) {
  const bodyText = await req.text();
  const signature = headers().get("x-razorpay-signature") as string;

  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    console.error("Razorpay webhook secret is not set.");
    return new NextResponse("Webhook secret not configured", { status: 500 });
  }

  // 1. Verify the webhook signature
  try {
    const shasum = crypto.createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET);
    shasum.update(bodyText);
    const digest = shasum.digest("hex");

    if (digest !== signature) {
      console.warn("Invalid Razorpay webhook signature.");
      return new NextResponse("Invalid signature", { status: 403 });
    }
  } catch (error) {
    console.error("Error verifying Razorpay webhook signature:", error);
    return new NextResponse("Webhook signature verification failed", {
      status: 400,
    });
  }

  // 2. Parse the payload
  let eventPayload: RazorpayWebhookPayload;
  try {
    eventPayload = JSON.parse(bodyText) as RazorpayWebhookPayload;
  } catch (error) {
    console.error("Error parsing Razorpay webhook payload:", error);
    return new NextResponse("Invalid payload", { status: 400 });
  }

  const eventType = eventPayload.event;
  const subscriptionData = eventPayload.payload.subscription?.entity;
  // const paymentData = eventPayload.payload.payment?.entity;

  console.log(`Received Razorpay webhook event: ${eventType}`);

  // 3. Handle specific events
  try {
    if (eventType === "subscription.activated") {
      if (!subscriptionData)
        throw new Error("Missing subscription data for activation");

      const userId = subscriptionData.notes?.userId; // Assuming userId was passed in notes
      if (!userId || typeof userId !== "string") {
        throw new Error("User ID not found or invalid in subscription notes");
      }

      console.log(
        `Processing subscription activation for user ${userId} and subscription ${subscriptionData.id}`,
      );

      try {
        // Check if subscription already exists (optional, based on your logic)
        const existingSubscription = await db.razorpaySubscription.findUnique({
          where: { razorpaySubscriptionId: subscriptionData.id },
        });

        if (!existingSubscription) {
          // Create if it doesn't exist (e.g., if initial creation failed or handled differently)
          await db.razorpaySubscription.create({
            data: {
              userId: userId,
              razorpaySubscriptionId: subscriptionData.id,
              razorpayPlanId: subscriptionData.plan_id,
              // razorpayCustomerId: subscriptionData.customer_id, // If customer created
              status: subscriptionData.status,
              currentPeriodEnd: new Date(subscriptionData.current_end * 1000),
            },
          });
          console.log(
            `Created new Razorpay subscription ${subscriptionData.id} for user ${userId}`,
          );
        } else {
          // Update if it exists
          await db.razorpaySubscription.update({
            where: { razorpaySubscriptionId: subscriptionData.id },
            data: {
              status: subscriptionData.status,
              currentPeriodEnd: new Date(subscriptionData.current_end * 1000),
              // Also update userId if it's different, ensuring the correct user is set
              userId: userId,
            },
          });
          console.log(
            `Updated Razorpay subscription ${subscriptionData.id} status to ${subscriptionData.status}`,
          );
        }
      } catch (dbError) {
        console.error(
          `Database error during subscription activation for ${subscriptionData.id}:`,
          dbError,
        );
        throw new Error(
          `Database error during subscription activation: ${dbError.message || "unknown error"}`,
        );
      }
    } else if (eventType === "subscription.charged") {
      if (!subscriptionData)
        throw new Error("Missing subscription data for charged event");

      // Extract userId from notes, needed for create part of upsert
      const userId = subscriptionData.notes?.userId;
      if (!userId || typeof userId !== "string") {
        // If no user ID in notes, we cannot reliably create the record here.
        // Log an error or handle differently. For now, we might just update if possible.
        // Alternatively, throw error, as this indicates an issue with subscription creation notes.
        console.error(
          `User ID not found or invalid in notes for subscription ${subscriptionData.id} during charged event.`,
        );
        // Option 1: Try update only (might fail if record doesn't exist)
        // await db.razorpaySubscription.update({ where: {...}, data: {...} });
        // Option 2: Throw an error (safer if userId is critical)
        throw new Error(
          "User ID not found or invalid in subscription notes during charged event",
        );
      }

      // Use upsert instead of just update
      await db.razorpaySubscription.upsert({
        where: {
          razorpaySubscriptionId: subscriptionData.id,
        },
        update: {
          status: subscriptionData.status, // Should be 'active'
          currentPeriodEnd: new Date(subscriptionData.current_end * 1000),
        },
        create: {
          // Provide all necessary fields for creation
          userId: userId,
          razorpaySubscriptionId: subscriptionData.id,
          razorpayPlanId: subscriptionData.plan_id,
          status: subscriptionData.status, // Initial status (should be 'active')
          currentPeriodEnd: new Date(subscriptionData.current_end * 1000),
          // Note: Assumes customerId is not strictly needed or handled elsewhere if required
        },
      });
      console.log(
        `Subscription ${subscriptionData.id} charged successfully (upserted), period extended.`,
      );
    } else if (
      eventType === "subscription.halted" ||
      eventType === "subscription.cancelled" ||
      eventType === "subscription.completed" ||
      eventType === "subscription.expired"
    ) {
      if (!subscriptionData)
        throw new Error(`Missing subscription data for ${eventType} event`);
      // Subscription is no longer active, update status
      await db.razorpaySubscription.update({
        where: {
          razorpaySubscriptionId: subscriptionData.id,
        },
        data: {
          status: subscriptionData.status, // Update with the final status
        },
      });
      console.log(
        `Subscription ${subscriptionData.id} status updated to ${subscriptionData.status}.`,
      );
    }
    // Add handlers for other relevant events (e.g., payment.failed, subscription.pending, etc.)
    else {
      console.log(`Unhandled Razorpay event type: ${eventType}`);
    }

    // 4. Acknowledge receipt
    return NextResponse.json(
      { message: "Webhook received successfully" },
      { status: 200 },
    );
  } catch (error: any) {
    console.error(
      `Error processing Razorpay webhook event ${eventType}:`,
      error,
    );
    return new NextResponse(
      `Webhook handler error: ${error.message || "Unknown error"}`,
      { status: 500 },
    );
  }
}
