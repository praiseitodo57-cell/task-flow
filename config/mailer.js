import { Brevo } from "@getbrevo/brevo";

const client = new Brevo({
  apiKey: process.env.BREVO_API_KEY,
});

export { client as brevo };