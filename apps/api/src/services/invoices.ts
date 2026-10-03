import PDFDocument from "pdfkit";
import { prisma } from "@purpio/db";
import { putObject } from "./storage.js";
export async function nextInvoiceNumber() {
  const y = new Date().getFullYear();
  const count = await prisma.invoice.count({ where: { number: { startsWith: `PUR-${y}-` } } });
  return `PUR-${y}-${String(count + 1).padStart(6, "0")}`;
}
export async function createInvoice(userId: string, amountCents: number, lineItems: { label: string; amountCents: number }[], paypalOrderId?: string, subscriptionId?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const number = await nextInvoiceNumber();
  const inv = await prisma.invoice.create({ data: { userId, number, amountCents, lineItems, status: "paid", paidAt: new Date(), paypalOrderId, subscriptionId } });
  const prefs = (user.prefs as { company?: string; vat?: string; address?: string }) ?? {};
  const pdf = await new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 }); const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fillColor("#7C3AED").fontSize(24).text("purpio.", { continued: false }).moveDown(0.5);
    doc.fillColor("#14121F").fontSize(11).text(`Invoice ${number}`).text(`Date ${inv.createdAt.toDateString()}`).text("Status: Paid").moveDown();
    doc.text("Billed to").font("Helvetica-Bold").text(prefs.company || user.name || user.email).font("Helvetica").text(user.email);
    if (prefs.vat) doc.text(`Tax ID ${prefs.vat}`); if (prefs.address) doc.text(prefs.address); doc.moveDown();
    for (const li of lineItems) doc.text(`${li.label}`, { continued: true }).text(`$${(li.amountCents / 100).toFixed(2)}`, { align: "right" });
    doc.moveDown().font("Helvetica-Bold").text("Total", { continued: true }).text(`$${(amountCents / 100).toFixed(2)} USD`, { align: "right" }).font("Helvetica");
    doc.moveDown(2).fillColor("#8B86A0").fontSize(9).text("Purpio · hello@purpio.com · Payments processed by PayPal.");
    doc.end();
  });
  const pdfUrl = await putObject(`invoices/${userId}/${number}.pdf`, pdf, "application/pdf", false);
  return prisma.invoice.update({ where: { id: inv.id }, data: { pdfUrl } });
}
