"use client";

export function InvoiceActions() {
  async function handleSendInvoice() {
    await sendInvoice();
  }

  async function handleCreateInvoice() {
    await createInvoice();
  }

  return <button onClick={handleSendInvoice}>Send invoice</button>;
}
