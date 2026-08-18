import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { formatInvoiceNo, type BillData } from "./bill-data";

export type LogoSource = { data: Buffer; format: "png" };

const NAVY = "#24399B";
const DARK_TEXT = "#18213A";
const DIVIDER = "#B7BEDA";
const TERMS_BG = "#F2F4FF";

const COMPANY_NAME = "Giniya Enterprize";
const COMPANY_PHONE = "8849660980";

const TERMS_LINE_1 = "Previous order dues must be cleared before the next order.";

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
    marginTop: 8,
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
    marginBottom: 8,
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
  termsBox: {
    flexDirection: "row",
    backgroundColor: TERMS_BG,
    borderRadius: 5,
    padding: "6pt",
  },
  termsLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: NAVY,
    width: "78pt",
    marginRight: 6,
  },
  termsTextBlock: {
    flex: 1,
  },
  termsText: {
    fontSize: 7.5,
    color: DARK_TEXT,
    lineHeight: 1.4,
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
        <Text style={styles.invoiceDetailText}>Invoice No: {formatInvoiceNo(bill.invoiceNo)}</Text>
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
      <Text style={styles.termsLabel}>Terms and Condition:</Text>
      <View style={styles.termsTextBlock}>
        <Text style={styles.termsText}>{TERMS_LINE_1}</Text>
        <Text style={styles.termsText}>
          If no further order is placed, payment must be cleared within{" "}
          <Text style={styles.termsBold}>45 days</Text> from the delivery date.
        </Text>
      </View>
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
