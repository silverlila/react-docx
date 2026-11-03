import { Document, Section, Paragraph, TextRun, Table, TableRow, TableCell } from "@react-docx/core";

type Line = { item: string; hours: number; rate: number };

const lines: Line[] = [
  { item: "Template design, three layouts", hours: 16, rate: 150 },
  { item: "Export service integration", hours: 12, rate: 140 },
  { item: "Review and handover", hours: 4, rate: 120 },
];

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const total = lines.reduce((sum, line) => sum + line.hours * line.rate, 0);

const rule = { style: "single", size: 4, color: "D5DAE3" } as const;
const borders = { top: rule, bottom: rule, left: rule, right: rule, insideHorizontal: rule, insideVertical: rule };

type CellProps = { text: string; align?: "left" | "right"; bold?: boolean; fill?: string };

function Cell({ text, align = "left", bold = false, fill }: CellProps) {
  return (
    <TableCell {...(fill ? { shading: { fill, type: "clear", color: "auto" } } : {})}>
      <Paragraph alignment={align} spacing={{ before: 60, after: 60 }}>
        <TextRun text={text} bold={bold} />
      </Paragraph>
    </TableCell>
  );
}

export default function Invoice() {
  return (
    <Document title="Invoice NW-2041" styles={{ default: { document: { run: { font: "Arial", size: 20 } } } }}>
      <Section>
        <Paragraph spacing={{ after: 80 }}>
          <TextRun text="INVOICE" bold size={18} color="2F5BD3" characterSpacing={40} />
        </Paragraph>
        <Paragraph spacing={{ after: 40 }}>
          <TextRun text="Northwind Studio" bold size={40} color="1F2A44" />
        </Paragraph>
        <Paragraph spacing={{ after: 360 }}>
          <TextRun text="Invoice NW-2041 · Issued 3 November 2026 · Due 3 December 2026" color="5B6474" />
        </Paragraph>

        <Paragraph spacing={{ after: 40 }}>
          <TextRun text="Billed to" bold color="5B6474" size={18} />
        </Paragraph>
        <Paragraph spacing={{ after: 360 }}>
          <TextRun text="Contoso Ltd, Finance team" />
        </Paragraph>

        <Table width={{ size: 9360, type: "dxa" }} columnWidths={[4860, 1300, 1600, 1600]} borders={borders}>
          <TableRow tableHeader>
            <Cell text="Description" bold fill="EEF2FA" />
            <Cell text="Hours" align="right" bold fill="EEF2FA" />
            <Cell text="Rate" align="right" bold fill="EEF2FA" />
            <Cell text="Amount" align="right" bold fill="EEF2FA" />
          </TableRow>
          {lines.map((line) => (
            <TableRow key={line.item}>
              <Cell text={line.item} />
              <Cell text={String(line.hours)} align="right" />
              <Cell text={money(line.rate)} align="right" />
              <Cell text={money(line.hours * line.rate)} align="right" />
            </TableRow>
          ))}
          <TableRow>
            <Cell text="Total" bold />
            <Cell text="" />
            <Cell text="" />
            <Cell text={money(total)} align="right" bold />
          </TableRow>
        </Table>

        <Paragraph spacing={{ before: 360 }}>
          <TextRun text="Pay by bank transfer within 30 days. Thank you for working with us." color="5B6474" />
        </Paragraph>
      </Section>
    </Document>
  );
}
