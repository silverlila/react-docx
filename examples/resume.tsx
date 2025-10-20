import React from "react";
import {
  Document,
  Section,
  Paragraph,
  TextRun,
  Break,
  renderToBuffer,
} from "@react-docx/core";
import fs from "node:fs";

/**
 * Resume Example
 *
 * Demonstrates building a professional resume with react-docx:
 * - Document metadata for file properties
 * - Custom page margins
 * - Consistent spacing and formatting
 * - Section headers with borders
 * - Multi-line contact information
 * - Professional layout
 */
const MARGINS = {
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440,
};

const ResumeExample = () => (
  <Document
    title="John Doe - Software Engineer"
    creator="John Doe"
    description="Professional resume for John Doe"
    styles={{
      paragraphStyles: [
        {
          id: "default",
          name: "Normal",
          basedOn: "Normal",
          run: { font: "Arial" },
        },
      ],
    }}
  >
    <Section properties={{ page: { margin: MARGINS } }}>
      {/* Name */}
      <Paragraph alignment="center" spacing={{ after: 100 }}>
        <TextRun text="JOHN DOE" bold={true} size={40} />
      </Paragraph>

      {/* Contact Information */}
      <Paragraph alignment="center" spacing={{ after: 300 }}>
        <TextRun text="Senior Software Engineer" size={24} />
        <Break />
        <TextRun text="San Francisco, CA • (555) 123-4567" size={20} />
        <Break />
        <TextRun
          text="john.doe@email.com • github.com/johndoe • linkedin.com/in/johndoe"
          size={20}
          color="2B6CB0"
        />
      </Paragraph>

      <ProfessionalSummary />

      <TechnicalSkills />

      {/* Professional Experience */}
      <Paragraph
        spacing={{ after: 100, before: 500 }}
        border={{ bottom: { style: "single", size: 20, color: "2B6CB0" } }}
      >
        <TextRun text="PROFESSIONAL EXPERIENCE" bold={true} size={28} />
      </Paragraph>

      {/* Job 1 */}
      <Paragraph spacing={{ after: 50, before: 150 }}>
        <TextRun text="Senior Software Engineer" bold={true} size={24} />
        <Break />
        <TextRun
          text="Tech Innovations Inc. • San Francisco, CA"
          size={22}
          italics={true}
        />
        <Break />
        <TextRun text="January 2020 - Present" size={20} color="555555" />
      </Paragraph>

      <Paragraph spacing={{ after: 80, before: 80 }} indent={{ left: 360 }}>
        <TextRun
          text="• Led development of microservices architecture serving 2M+ daily active users"
          size={22}
        />
      </Paragraph>

      <Paragraph spacing={{ after: 80 }} indent={{ left: 360 }}>
        <TextRun
          text="• Architected and implemented real-time collaboration features using WebSockets"
          size={22}
        />
      </Paragraph>

      <Paragraph spacing={{ after: 80 }} indent={{ left: 360 }}>
        <TextRun
          text="• Reduced page load times by 60% through code splitting and lazy loading"
          size={22}
        />
      </Paragraph>

      <Paragraph spacing={{ after: 250 }} indent={{ left: 360 }}>
        <TextRun
          text="• Mentored team of 5 junior developers and conducted technical interviews"
          size={22}
        />
      </Paragraph>

      {/* Job 2 */}
      <Paragraph spacing={{ after: 50 }}>
        <TextRun text="Software Engineer" bold={true} size={24} />
        <Break />
        <TextRun
          text="Digital Solutions Corp. • Palo Alto, CA"
          size={22}
          italics={true}
        />
        <Break />
        <TextRun text="June 2017 - December 2019" size={20} color="555555" />
      </Paragraph>

      <Paragraph spacing={{ after: 80, before: 80 }} indent={{ left: 360 }}>
        <TextRun
          text="• Developed responsive web applications using React and Redux"
          size={22}
        />
      </Paragraph>

      <Paragraph spacing={{ after: 80 }} indent={{ left: 360 }}>
        <TextRun
          text="• Implemented automated testing increasing code coverage from 40% to 85%"
          size={22}
        />
      </Paragraph>

      <Paragraph spacing={{ after: 250 }} indent={{ left: 360 }}>
        <TextRun
          text="• Collaborated with UX designers to create accessible user interfaces"
          size={22}
        />
      </Paragraph>

      {/* Education */}
      <Paragraph
        spacing={{ after: 100, before: 500 }}
        border={{ bottom: { style: "single", size: 20, color: "2B6CB0" } }}
      >
        <TextRun text="EDUCATION" bold={true} size={28} />
      </Paragraph>

      <Paragraph spacing={{ after: 50, before: 150 }}>
        <TextRun
          text="Bachelor of Science in Computer Science"
          bold={true}
          size={24}
        />
        <Break />
        <TextRun
          text="Stanford University • Stanford, CA"
          size={22}
          italics={true}
        />
        <Break />
        <TextRun
          text="Graduated: May 2017 • GPA: 3.8/4.0"
          size={20}
          color="555555"
        />
      </Paragraph>
    </Section>
  </Document>
);

function ProfessionalSummary() {
  return (
    <>
      <Paragraph
        spacing={{ after: 100, before: 500 }}
        border={{ bottom: { style: "single", size: 20, color: "2B6CB0" } }}
      >
        <TextRun text="PROFESSIONAL SUMMARY" bold={true} size={28} />
      </Paragraph>
      <Paragraph spacing={{ after: 300 }}>
        <TextRun
          text="Results-driven Software Engineer with 8+ years of experience building scalable web applications and leading development teams. Expertise in React, TypeScript, and Node.js with a proven track record of delivering high-quality software solutions. Passionate about creating intuitive user experiences and mentoring junior developers."
          size={22}
        />
      </Paragraph>
    </>
  );
}

function TechnicalSkills() {
  return (
    <>
      <Paragraph
        spacing={{ after: 100, before: 500 }}
        border={{ bottom: { style: "single", size: 20, color: "2B6CB0" } }}
      >
        <TextRun text="TECHNICAL SKILLS" bold={true} size={28} />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="Languages: " bold={true} size={22} />
        <TextRun text="JavaScript, TypeScript, Python, Go" size={22} />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="Frontend: " bold={true} size={22} />
        <TextRun
          text="React, Next.js, Vue.js, HTML5, CSS3, Tailwind CSS"
          size={22}
        />
      </Paragraph>

      <Paragraph spacing={{ after: 100 }}>
        <TextRun text="Backend: " bold={true} size={22} />
        <TextRun
          text="Node.js, Express, FastAPI, PostgreSQL, MongoDB, Redis"
          size={22}
        />
      </Paragraph>

      <Paragraph spacing={{ after: 300 }}>
        <TextRun text="Tools: " bold={true} size={22} />
        <TextRun
          text="Git, Docker, Kubernetes, AWS, CI/CD, Jest, Playwright"
          size={22}
        />
      </Paragraph>
    </>
  );
}
export default ResumeExample;
async function generateResumeExample() {
  try {
    console.log("Generating resume example...\n");

    const buffer = await renderToBuffer(<ResumeExample />);
    fs.writeFileSync("examples/resume.docx", buffer);

    console.log("✅ Resume example generated successfully!");
    console.log("   File: examples/resume.docx");
    console.log(`   Size: ${buffer.length} bytes\n`);
  } catch (error) {
    console.error("❌ Error generating document:", error);
    throw error;
  }
}

generateResumeExample();
