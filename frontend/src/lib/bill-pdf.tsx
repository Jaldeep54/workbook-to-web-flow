import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { formatInvoiceNo, type BillData } from "./bill-data";

/**
 * The logo is a plain URL now that bills are rendered in the browser —
 * react-pdf fetches it from the app's own /public folder. Bill *data*
 * (invoice number, prices, shop details) still comes from the API; only the
 * rendering happens here.
 */
export type LogoSource = string;

const NAVY = "#24399B";
const DARK_TEXT = "#18213A";
const DIVIDER = "#B7BEDA";
const TERMS_BG = "#F2F4FF";

const COMPANY_NAME = "Giniya Enterprise";
const COMPANY_PHONE = "8849660980";

/**
 * The terms printed on both halves of every bill, as supplied by the company.
 * Each is a short bold heading and the sentence that follows it, so a
 * shopkeeper scanning the box can find the clause that concerns them.
 */
const TERMS: Array<{ heading: string; text: string }> = [
  {
    heading: "Payment",
    text: "Repeated/Active Parties must clear their outstanding bill within the payment date specified by the Company.",
  },
  {
    heading: "45-Day Reorder",
    text: "If a party does not place a repeat order within 45 days from the date of the last order, all outstanding dues for products already sold shall become payable immediately.",
  },
  {
    heading: "Unsold Stock",
    text: "In such a case, the Company may take back the remaining unsold stock in saleable condition, subject to stock verification.",
  },
  {
    heading: "Onboarding Cancellation",
    text: "The Company reserves the right to cancel/terminate the party's onboarding/business association in case of non-payment or failure to reorder within 45 days.",
  },
];

const COL = {
  sno: "8%",
  item: "32%",
  qty: "15%",
  unit: "13%",
  price: "16%",
  amount: "16%",
  // Precomputed sum of sno+item+qty+unit (8+32+15+13) — react-pdf's style
  // engine doesn't reliably evaluate calc(), so this is a literal, not an
  // expression, and must be kept in sync with the four widths above by hand.
  leadingSpacer: "68%",
} as const;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 8,
    color: DARK_TEXT,
  },
  half: {
    height: "148.5mm",
    padding: "5mm",
  },
  dashedDivider: {
    position: "absolute",
    top: "148.5mm",
    left: "5mm",
    right: "5mm",
    borderBottomWidth: 1,
    borderBottomStyle: "dashed",
    borderBottomColor: NAVY,
  },
  card: {
    flex: 1,
    flexDirection: "column",
    border: `1pt solid ${NAVY}`,
    borderRadius: 6,
    padding: "8pt",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  companyName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    color: DARK_TEXT,
  },
  companyPhone: {
    fontSize: 7.5,
    color: "#5B6472",
    marginTop: 1,
  },
  docTitle: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: NAVY,
    textAlign: "center",
    marginTop: 3,
  },
  logo: {
    width: 68,
    height: 26,
    objectFit: "contain",
  },
  logoFallback: {
    fontFamily: "Helvetica-Bold",
    fontSize: 15,
    color: NAVY,
  },
  headerRule: {
    borderBottomWidth: 1.25,
    borderBottomColor: NAVY,
    marginTop: 6,
    marginBottom: 8,
  },
  detailsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: NAVY,
    marginBottom: 2,
  },
  shopName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: DARK_TEXT,
  },
  shopAddress: {
    fontSize: 7.5,
    color: "#4B5468",
    marginTop: 1,
    maxWidth: "90mm",
  },
  invoiceDetailText: {
    fontSize: 8,
    color: DARK_TEXT,
    textAlign: "right",
    marginTop: 1,
  },
  table: {
    borderTopWidth: 0,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: NAVY,
    paddingVertical: 4,
  },
  tableHeaderCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: "#FFFFFF",
    textAlign: "center",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3.5,
    borderBottomWidth: 0.75,
    borderBottomColor: DIVIDER,
  },
  tableCell: {
    fontSize: 8,
    color: DARK_TEXT,
    textAlign: "center",
  },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderTopWidth: 1.5,
    borderTopColor: NAVY,
  },
  totalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: NAVY,
    textAlign: "center",
  },
  totalAmount: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: NAVY,
    textAlign: "center",
  },
  amountWordsBlock: {
    marginTop: 6,
  },
  amountWordsValue: {
    fontSize: 8,
    color: DARK_TEXT,
    marginTop: 1,
  },
  spacer: {
    flex: 1,
  },
  signatureBlock: {
    alignItems: "flex-end",
    marginBottom: 6,
  },
  signatureLine: {
    width: "45mm",
    borderTopWidth: 1,
    borderTopColor: DARK_TEXT,
    marginBottom: 3,
  },
  signatureLabel: {
    fontSize: 7.5,
    color: DARK_TEXT,
  },
  /**
   * Four clauses have to sit in the strip left under the signature on a
   * 148.5mm half, so the type here is deliberately smaller and tighter than
   * anywhere else on the bill. Enlarging any of it pushes the last clause
   * through the card's border — the layout has roughly a line to spare.
   */
  termsBox: {
    backgroundColor: TERMS_BG,
    borderRadius: 5,
    padding: "5pt",
  },
  termsLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    color: NAVY,
    marginBottom: 2,
  },
  termsRow: {
    flexDirection: "row",
    marginBottom: 1,
  },
  termsNumber: {
    fontSize: 6.5,
    color: DARK_TEXT,
    width: "8pt",
  },
  termsText: {
    flex: 1,
    fontSize: 6.5,
    color: DARK_TEXT,
    lineHeight: 1.25,
  },
  termsBold: {
    fontFamily: "Helvetica-Bold",
  },
});

function BillHeader({ title, logoSrc }: { title: string; logoSrc: LogoSource | null }) {
  return (
    <>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.companyName}>{COMPANY_NAME}</Text>
          <Text style={styles.companyPhone}>Phone no: {COMPANY_PHONE}</Text>
        </View>
        <Text style={styles.docTitle}>{title}</Text>
        {logoSrc ? (
          <Image style={styles.logo} src={logoSrc} />
        ) : (
          <Text style={styles.logoFallback}>Klinzo</Text>
        )}
      </View>
      <View style={styles.headerRule} />
    </>
  );
}

function BillDetails({ bill }: { bill: BillData }) {
  return (
    <View style={styles.detailsRow}>
      <View>
        <Text style={styles.label}>Bill To</Text>
        <Text style={styles.shopName}>{bill.shopName}</Text>
        {bill.shopAddress && <Text style={styles.shopAddress}>{bill.shopAddress}</Text>}
      </View>
      <View>
        <Text style={[styles.label, { textAlign: "right" }]}>Invoice Details</Text>
        <Text style={styles.invoiceDetailText}>
          Invoice No: {formatInvoiceNo(bill.invoiceNo, bill.shopCode)}
        </Text>
        <Text style={styles.invoiceDetailText}>Date: {bill.deliveryDateLabel}</Text>
      </View>
    </View>
  );
}

function BillTable({ bill }: { bill: BillData }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.tableHeaderCell, { width: COL.sno }]}>S.No</Text>
        <Text style={[styles.tableHeaderCell, { width: COL.item }]}>Item Name</Text>
        <Text style={[styles.tableHeaderCell, { width: COL.qty }]}>Quantity</Text>
        <Text style={[styles.tableHeaderCell, { width: COL.unit }]}>Unit</Text>
        <Text style={[styles.tableHeaderCell, { width: COL.price }]}>Price/Unit</Text>
        <Text style={[styles.tableHeaderCell, { width: COL.amount }]}>Amount</Text>
      </View>
      {bill.lines.map((line, i) => (
        <View key={line.itemName} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: COL.sno }]}>{i + 1}</Text>
          <Text style={[styles.tableCell, { width: COL.item }]}>{line.itemName}</Text>
          <Text style={[styles.tableCell, { width: COL.qty }]}>{line.quantity}</Text>
          <Text style={[styles.tableCell, { width: COL.unit }]}>{line.unit}</Text>
          <Text style={[styles.tableCell, { width: COL.price }]}>
            {line.pricePerUnit.toFixed(2)}
          </Text>
          <Text style={[styles.tableCell, { width: COL.amount }]}>{line.amount.toFixed(2)}</Text>
        </View>
      ))}
      <View style={styles.totalRow}>
        <View style={{ width: COL.leadingSpacer }} />
        <Text style={[styles.totalLabel, { width: COL.price }]}>TOTAL</Text>
        <Text style={[styles.totalAmount, { width: COL.amount }]}>
          {bill.totalAmount.toFixed(2)}
        </Text>
      </View>
    </View>
  );
}

function TermsBox() {
  return (
    <View style={styles.termsBox}>
      <Text style={styles.termsLabel}>Terms &amp; Conditions</Text>
      {TERMS.map((term, i) => (
        <View key={term.heading} style={styles.termsRow} wrap={false}>
          <Text style={styles.termsNumber}>{i + 1}.</Text>
          <Text style={styles.termsText}>
            <Text style={styles.termsBold}>{term.heading}:</Text> {term.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function BillDocumentHalf({
  title,
  bill,
  logoSrc,
}: {
  title: "INVOICE" | "DELIVERY CHALLAN";
  bill: BillData;
  logoSrc: LogoSource | null;
}) {
  return (
    <View style={styles.half}>
      <View style={styles.card}>
        <BillHeader title={title} logoSrc={logoSrc} />
        <BillDetails bill={bill} />
        <BillTable bill={bill} />
        <View style={styles.amountWordsBlock}>
          <Text style={styles.label}>Invoice Amount In Words</Text>
          <Text style={styles.amountWordsValue}>{bill.totalAmountWords}</Text>
        </View>
        <View style={styles.spacer} />
        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine} />
          <Text style={styles.signatureLabel}>Authorized Signatory</Text>
        </View>
        <TermsBox />
      </View>
    </View>
  );
}

/** One A4 page per order: Invoice on top, Delivery Challan on bottom, split exactly at 148.5mm. */
export function BillsDocument({
  bills,
  logoSrc,
}: {
  bills: BillData[];
  logoSrc: LogoSource | null;
}) {
  return (
    <Document>
      {bills.map((bill) => (
        <Page key={bill.orderId} size="A4" style={styles.page}>
          <BillDocumentHalf title="INVOICE" bill={bill} logoSrc={logoSrc} />
          <BillDocumentHalf title="DELIVERY CHALLAN" bill={bill} logoSrc={logoSrc} />
          <View style={styles.dashedDivider} />
        </Page>
      ))}
    </Document>
  );
}
