import { BrevoClient } from "@getbrevo/brevo";

const apiKey = process.env.BREVO_API_KEY;
console.log("[mailer] key length:", apiKey?.length);
console.log("[mailer] key preview:", apiKey?.slice(0, 10));

const client = new BrevoClient({ apiKey });

export { client as brevo };