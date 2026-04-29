// config/mailer.js
import SibApiV3Sdk from "@getbrevo/brevo";

const client = new SibApiV3Sdk.TransactionalEmailsApi();
client.authentications["apiKey"].apiKey = process.env.BREVO_API_KEY;

export { client as brevo };