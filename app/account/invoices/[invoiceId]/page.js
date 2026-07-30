import CustomInvoicePage from "../../../components/customInvoicePage";

export const metadata = {
  description: "View a Munetios invoice.",
  title: "Invoice | Munetios",
};

export default async function InvoicePage({ params }) {
  const { invoiceId } = await params;

  return <CustomInvoicePage invoiceId={invoiceId} />;
}
