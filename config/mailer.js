// config/mailer.js
import * as Brevo from "@getbrevo/brevo";

const client = new Brevo.TransactionalEmailsApi();
client.authentications["apiKey"].apiKey = process.env.BREVO_API_KEY;

export { client as brevo };