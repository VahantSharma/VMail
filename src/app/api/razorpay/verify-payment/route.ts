import { env } from "@/env.js";
import { db } from "@/server/db";
import { auth } from "@clerk/nextjs/server";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

// Input validation schema
const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().optional(), // Order ID might be sent for order payments
  razorpay_payment_id: z.string(),
  razorpay_subscription_id: z.string().optional(), // Subscription ID for subscription payments
  razorpay_signature: z.string(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let requestBody;
  try {
    requestBody = await req.json();
  } catch (error) {
    return new NextResponse("Invalid request body", { status: 400 });
  }

  const parsed = verifyPaymentSchema.safeParse(requestBody);
  if (!parsed.success) {
    return new NextResponse(`Invalid input: ${parsed.error.message}`, {
      status: 400,
    });
  }

  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_signature,
    razorpay_order_id,
  } = parsed.data;

  if (!env.RAZORPAY_KEY_SECRET) {
    console.error("Razorpay key secret is not configured.");
    return new NextResponse("Server configuration error", { status: 500 });
  }

  // Construct the string to hash for signature verification
  // For subscriptions, it's typically payment_id + '|' + subscription_id
  // For orders, it's typically order_id + '|' + payment_id
  // Ensure this matches Razorpay's documentation for the specific flow.
  const bodyToSign = razorpay_subscription_id
    ? `${razorpay_payment_id}|${razorpay_subscription_id}`
    : `${razorpay_order_id}|${razorpay_payment_id}`; // Fallback for order_id if subscription_id is missing

  if (!razorpay_subscription_id && !razorpay_order_id) {
    return new NextResponse(
      `Missing order_id or subscription_id for verification`,
      { status: 400 },
    );
  }

  try {
    const expectedSignature = crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(bodyToSign)
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      console.log(
        `Payment verification successful for payment_id: ${razorpay_payment_id}`,
      );
      // Signature is correct - Payment is verified

      // Optional: Find the subscription linked to this payment/subscription ID
      // and update its status *immediately* if needed, or just rely on the webhook.
      // This provides faster UI feedback but adds complexity.
      if (razorpay_subscription_id) {
        try {
          // First, check if the subscription exists
          const subscription = await db.razorpaySubscription.findFirst({
            where: {
              razorpaySubscriptionId: razorpay_subscription_id,
            },
          });

          if (subscription && subscription.userId === userId) {
            // Subscription exists and belongs to this user - all good
            console.log(
              `Subscription ${razorpay_subscription_id} found for user ${userId}. Webhook will handle final activation.`
            );
          } else if (subscription && subscription.userId !== userId) {
            // Subscription exists but belongs to a different user - log but don't fail
            console.warn(
              `User mismatch: Subscription ${razorpay_subscription_id} exists but belongs to user ${subscription.userId}, not ${userId}`
            );
          } else {
            // Subscription not found - create a preliminary record
            console.log(
              `Subscription ${razorpay_subscription_id} not found. Creating preliminary record.`
            );
            
            // Create a preliminary record with minimal information
            // The webhook will update with complete details later
            await db.razorpaySubscription.create({
              data: {
                userId: userId,
                razorpaySubscriptionId: razorpay_subscription_id,
                status: "created", // Initial status before webhook confirms activation
                currentPeriodEnd: new Date(Date.now() + 86400000), // Set to 24h in future temporarily
              },
            });
            
            console.log(
              `Created preliminary subscription record for ${razorpay_subscription_id} for user ${userId}`
            );
          }
        } catch (dbError) {
          // Log database error but don't fail payment verification
          console.error(
            `Database error during subscription check/creation for ${razorpay_subscription_id}:`, 
            dbError
          );
        }
      }

      return NextResponse.json(
        { verified: true, message: "Payment verified successfully" },
        { status: 200 },
      );
    } else {
      // Signature mismatch - Payment is fraudulent or there's an issue
      console.warn(
        `Payment verification failed for payment_id: ${razorpay_payment_id}. Signature mismatch.`,
      );
      return new NextResponse("Payment verification failed", { status: 400 });
    }
  } catch (error: any) {
    console.error("Error during Razorpay payment verification:", error);
    return new NextResponse(
      `Verification processing error: ${error.message || "Unknown error"}`,
      { status: 500 },
    );
  }
}
