import { Fragment } from "react";
import { Document, Section, Paragraph, TextRun, List, ListItem } from "@react-docx/core";

type Job = { role: string; company: string; dates: string; points: string[] };

const jobs: Job[] = [
  {
    role: "Staff Engineer",
    company: "Northwind Labs",
    dates: "2021 – now",
    points: [
      "Led the document platform used by 40 product teams",
      "Cut export time from 9s to 600ms by rendering templates once",
      "Designed the template API that replaced three separate renderers",
    ],
  },
  {
    role: "Senior Engineer",
    company: "Contoso",
    dates: "2017 – 2021",
    points: ["Built the resume builder's preview and export", "Mentored six engineers"],
  },
];

function Heading({ children }: { children: string }) {
  return (
    <Paragraph spacing={{ before: 320, after: 120 }} border={{ bottom: { style: "single", size: 6, color: "2F5BD3" } }}>
      <TextRun text={children.toUpperCase()} bold size={22} color="2F5BD3" characterSpacing={20} />
    </Paragraph>
  );
}

export default function Resume() {
  return (
    <Document title="Ada Lovelace — Resume" styles={{ default: { document: { run: { font: "Arial", size: 20 } } } }}>
      <Section properties={{ page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }}>
        <Paragraph spacing={{ after: 40 }}>
          <TextRun text="Ada Lovelace" bold size={44} />
        </Paragraph>
        <Paragraph spacing={{ after: 80 }}>
          <TextRun text="Staff Software Engineer · London · ada@example.com" color="555F6D" />
        </Paragraph>

        <Paragraph spacing={{ before: 200 }}>
          <TextRun text="Engineer who turns document formats into tools people enjoy. Ten years of building editors, renderers and the pipelines between them." />
        </Paragraph>

        <Heading>Experience</Heading>
        {jobs.map((job) => (
          <Fragment key={job.company}>
            <Paragraph spacing={{ before: 120 }}>
              <TextRun text={job.role} bold />
              <TextRun text={`, ${job.company}`} />
              <TextRun text={`   ${job.dates}`} color="555F6D" />
            </Paragraph>
            <List>
              {job.points.map((point) => (
                <ListItem key={point}>{point}</ListItem>
              ))}
            </List>
          </Fragment>
        ))}

        <Heading>Education</Heading>
        <Paragraph spacing={{ before: 120 }}>
          <TextRun text="BSc Mathematics" bold />
          <TextRun text=", University of London" />
          <TextRun text="   2013" color="555F6D" />
        </Paragraph>

        <Heading>Skills</Heading>
        <Paragraph>
          <TextRun text="TypeScript, React, Node.js, document formats, " />
          <TextRun text="and a weakness for analytical engines." italics />
        </Paragraph>
      </Section>
    </Document>
  );
}
