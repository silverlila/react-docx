import { Document, Section, Paragraph, TextRun, Table, TableRow, TableCell } from "@react-docx/core";

const rows = [
  ["Design review", "Ada", "Done"],
  ["Reader", "Grace", "Done"],
  ["Preview", "Linus", "In progress"],
];

const border = { style: "single", size: 4, color: "BFC7D5" } as const;
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

export default function StatusTable() {
  return (
    <Document>
      <Section>
        <Table width={{ size: 9360, type: "dxa" }} columnWidths={[4680, 2340, 2340]} borders={borders}>
          <TableRow tableHeader>
            {["Task", "Owner", "Status"].map((title) => (
              <TableCell key={title} shading={{ fill: "EEF2FA", type: "clear", color: "auto" }}>
                <Paragraph>
                  <TextRun text={title} bold />
                </Paragraph>
              </TableCell>
            ))}
          </TableRow>
          {rows.map((row) => (
            <TableRow key={row[0]}>
              {row.map((cell) => (
                <TableCell key={cell}>
                  <Paragraph>
                    <TextRun text={cell} />
                  </Paragraph>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </Table>
      </Section>
    </Document>
  );
}
