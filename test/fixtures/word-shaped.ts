import { PNG_1PX } from "../support/cases";
import { docx, part, type FixtureParts } from "../support/docx-fixture";

const OFFICE_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PICTURE_URI = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const CHART_URI = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DATE = "2024-03-01T10:00:00Z";

const THEME =
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>' +
  '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  "</a:themeElements></a:theme>";

const SETTINGS = part(
  "w:settings",
  '<w:zoom w:percent="100"/><w:proofState w:spelling="clean" w:grammar="clean"/><w:defaultTabStop w:val="720"/>' +
    '<w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '<w:rsids><w:rsidRoot w:val="00A13B2C"/><w:rsid w:val="00A13B2C"/></w:rsids>',
);

const LATENT_STYLES =
  '<w:latentStyles w:defLockedState="0" w:defUIPriority="99" w:defSemiHidden="0" w:defUnhideWhenUsed="0" w:defQFormat="0" w:count="376">' +
  '<w:lsdException w:name="Normal" w:uiPriority="0" w:qFormat="1"/><w:lsdException w:name="heading 1" w:uiPriority="9" w:qFormat="1"/></w:latentStyles>';

const styles = (extra: string): string =>
  "<w:docDefaults><w:rPrDefault><w:rPr>" +
  '<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/>' +
  '<w:kern w:val="2"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/>' +
  '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  LATENT_STYLES +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
  '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
  extra;

const SECT_PR =
  '<w:sectPr w:rsidR="00A13B2C"><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
  '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';

const GO_BACK = '<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>';

const p = (content: string, pPr = ""): string =>
  `<w:p w:rsidR="00A13B2C" w:rsidRDefault="00A13B2C" w:rsidP="00A13B2C">${pPr === "" ? "" : `<w:pPr>${pPr}</w:pPr>`}${content}</w:p>`;
const r = (text: string, rPr = ""): string =>
  `<w:r w:rsidRPr="00A13B2C">${rPr === "" ? "" : `<w:rPr>${rPr}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const styled = (style: string, content: string): string => p(content, `<w:pStyle w:val="${style}"/>`);
const field = (instruction: string, result: string): string =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  `<w:r><w:rPr><w:noProof/></w:rPr><w:t>${result}</w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

type WordParts = Omit<FixtureParts, "styles" | "theme"> & { readonly styles?: string; readonly sectPr?: string };

const wordDocument = ({ body, styles: extraStyles = "", sectPr = SECT_PR, ...rest }: WordParts): Uint8Array =>
  docx({
    ...rest,
    body: body + sectPr,
    styles: styles(extraStyles),
    theme: THEME,
    parts: { "word/settings.xml": SETTINGS, ...rest.parts },
    rels: `<Relationship Id="rIdSettings" Type="${OFFICE_RELS}/settings" Target="settings.xml"/>${rest.rels ?? ""}`,
  });

const sectPrWith = (references: string, after = ""): string =>
  SECT_PR.replace('<w:sectPr w:rsidR="00A13B2C">', `<w:sectPr w:rsidR="00A13B2C">${references}`).replace(
    "<w:docGrid",
    `${after}<w:docGrid`,
  );

const HEADING_STYLES =
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading1Char"/><w:uiPriority w:val="9"/><w:qFormat/>' +
  '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr>' +
  '<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/>' +
  '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr>' +
  '<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:customStyle="1" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="Heading1"/><w:uiPriority w:val="9"/>' +
  '<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
  '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>';

const NONE_BORDERS = ["top", "left", "bottom", "right", "insideH", "insideV"]
  .map((side) => `<w:${side} w:val="none" w:sz="0" w:space="0" w:color="auto"/>`)
  .join("");
const TABLE_LOOK =
  '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>';
const cell = (width: number, text: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${p(r(text), '<w:spacing w:after="0"/>')}</w:tc>`;
const row = (...cells: string[]): string => `<w:tr w:rsidR="00A13B2C" w:rsidTr="00A13B2C">${cells.join("")}</w:tr>`;
const table = (tblPr: string, rows: string[]): string =>
  `<w:tbl><w:tblPr>${tblPr}${TABLE_LOOK}</w:tblPr><w:tblGrid><w:gridCol w:w="4675"/><w:gridCol w:w="4675"/></w:tblGrid>${rows.join("")}</w:tbl>`;

const ABSTRACT_BULLET =
  '<w:abstractNum w:abstractNumId="0"><w:nsid w:val="1A2B3C4D"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="04090001"/>' +
  '<w:lvl w:ilvl="0" w:tplc="04090001"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>' +
  "</w:abstractNum>";
const ABSTRACT_DECIMAL =
  '<w:abstractNum w:abstractNumId="1"><w:nsid w:val="2B3C4D5E"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="0409000F"/>' +
  '<w:lvl w:ilvl="0" w:tplc="0409000F"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  "</w:abstractNum>";
const NUMBERING =
  ABSTRACT_BULLET +
  ABSTRACT_DECIMAL +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
const listItem = (numId: number, text: string): string =>
  p(r(text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`);

const resume = wordDocument({
  body:
    styled("Title", r("Ada Lovelace")) +
    p(`<w:proofErr w:type="spellStart"/>${r("Analyst")}<w:proofErr w:type="spellEnd"/>${r(", London")}${GO_BACK}`) +
    p(
      `<w:hyperlink r:id="rIdLink" w:history="1">${r("ada.example.com", '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`,
    ) +
    table(`<w:tblW w:w="0" w:type="auto"/><w:tblBorders>${NONE_BORDERS}</w:tblBorders>`, [
      row(cell(4675, "Email"), cell(4675, "ada@example.com")),
    ]) +
    styled("Heading1", r("Experience")) +
    table('<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>', [
      row(cell(4675, "1842"), cell(4675, "Notes on the Engine")),
    ]) +
    listItem(1, "Mathematics") +
    listItem(1, "Poetry") +
    styled("Heading1", `<w:r><w:lastRenderedPageBreak/><w:t>Steps</w:t></w:r>`) +
    listItem(2, "Read") +
    listItem(2, "Annotate") +
    listItem(3, "Again from one"),
  sectPr: sectPrWith(
    '<w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>',
  ),
  styles: HEADING_STYLES,
  numbering: NUMBERING,
  rels:
    `<Relationship Id="rIdLink" Type="${OFFICE_RELS}/hyperlink" Target="https://ada.example.com/" TargetMode="External"/>` +
    `<Relationship Id="rIdHeader" Type="${OFFICE_RELS}/header" Target="header1.xml"/>` +
    `<Relationship Id="rIdFooter" Type="${OFFICE_RELS}/footer" Target="footer1.xml"/>`,
  parts: {
    "word/header1.xml": part("w:hdr", p(r("Page ") + field("PAGE", "1"), '<w:jc w:val="right"/>')),
    "word/footer1.xml": part("w:ftr", p(r("of ") + field("NUMPAGES", "1"))),
  },
});

const formatting = wordDocument({
  body: p(
    r("accent", '<w:color w:val="4472C4" w:themeColor="accent1"/>') +
      r("theme only", '<w:color w:themeColor="accent1"/>') +
      r("ligatures", '<w14:ligatures w14:val="standard"/>') +
      r("spaced", '<w:spacing w:val="20"/>') +
      r("marked", '<w:highlight w:val="yellow"/>') +
      r("changed", `<w:b/><w:rPrChange w:id="1" w:author="Ada" w:date="${DATE}"><w:rPr><w:i/></w:rPr></w:rPrChange>`) +
      GO_BACK,
  ),
});

const FOOTNOTE_STYLES =
  '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:link w:val="FootnoteTextChar"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
  '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>';
const SEPARATORS =
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
const footnote = (id: number, text: string): string =>
  `<w:footnote w:id="${id}">${p(`<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${r(` ${text}`)}`, '<w:pStyle w:val="FootnoteText"/>')}</w:footnote>`;
const footnoteReference = (id: number): string =>
  `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;

const notes = wordDocument({
  body:
    p(r("First claim.") + footnoteReference(1) + r(" Second claim.") + footnoteReference(2)) +
    p(
      '<w:commentRangeStart w:id="0"/>' +
        r("Two ") +
        r("runs", "<w:b/>") +
        '<w:commentRangeEnd w:id="0"/>' +
        '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>',
    ) +
    p(
      r("Kept ") +
        `<w:ins w:id="1" w:author="Ada" w:date="${DATE}"><w:r><w:t xml:space="preserve">added </w:t></w:r></w:ins>` +
        `<w:del w:id="2" w:author="Ada" w:date="${DATE}"><w:r><w:delText>removed</w:delText></w:r></w:del>` +
        GO_BACK,
    ),
  styles: FOOTNOTE_STYLES,
  footnotes: SEPARATORS + footnote(1, "Note one.") + footnote(2, "Note two."),
  comments: `<w:comment w:id="0" w:author="Ada" w:date="${DATE}" w:initials="AL">${p("<w:r><w:annotationRef/></w:r>" + r("Check this."))}</w:comment>`,
});

const LANDSCAPE_SECT_PR = SECT_PR.replace(
  '<w:pgSz w:w="12240" w:h="15840"/>',
  '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>',
);
const PORTRAIT_SECT_PR = sectPrWith(
  '<w:headerReference w:type="first" r:id="rIdFirst"/><w:headerReference w:type="default" r:id="rIdDefault"/>',
  "<w:titlePg/>",
);

const sections = wordDocument({
  body: p(r("Portrait") + GO_BACK) + p(r("End of portrait"), PORTRAIT_SECT_PR) + p(r("Landscape")),
  sectPr: LANDSCAPE_SECT_PR,
  rels: `<Relationship Id="rIdFirst" Type="${OFFICE_RELS}/header" Target="header1.xml"/><Relationship Id="rIdDefault" Type="${OFFICE_RELS}/header" Target="header2.xml"/>`,
  parts: {
    "word/header1.xml": part("w:hdr", p(r("First page"))),
    "word/header2.xml": part("w:hdr", p(r("Every other page"))),
  },
});

const pic = (srcRect = "", xfrm = ""): string =>
  `<a:graphic><a:graphicData uri="${PICTURE_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="photo.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="rIdImage"><a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext></a:extLst></a:blip>${srcRect}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm${xfrm}><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
const inline = (id: number, inside: string): string =>
  `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="952500" cy="952500"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
  `<wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>${inside}</wp:inline></w:drawing>`;
const anchored =
  '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>3200400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="952500" cy="952500"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="2" name="Picture 2"/>' +
  `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>${pic("", ' rot="31905"')}</wp:anchor></w:drawing>`;
const chart =
  '<mc:AlternateContent><mc:Choice Requires="cx1">' +
  `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="952500" cy="952500"/><wp:docPr id="4" name="Chart 4"/>` +
  `<a:graphic><a:graphicData uri="${CHART_URI}"><c:chart xmlns:c="${CHART_URI}" r:id="rIdChart"/></a:graphicData></a:graphic></wp:inline></w:drawing>` +
  `</mc:Choice><mc:Fallback>${inline(5, pic())}</mc:Fallback></mc:AlternateContent>`;
const contentControl =
  '<w:sdt><w:sdtPr><w:id w:val="-1873453"/><w:placeholder><w:docPart w:val="DefaultPlaceholder_-1854013440"/></w:placeholder><w:text/></w:sdtPr>' +
  `<w:sdtContent>${r("Company name")}</w:sdtContent></w:sdt>`;
const fraction =
  "<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>";

const objects = wordDocument({
  body:
    p(`<w:r>${inline(1, pic())}</w:r>`) +
    p(`<w:r>${anchored}</w:r>${r("Text beside the floating picture.")}`) +
    p(`<w:r>${inline(3, pic('<a:srcRect l="10000" r="10000"/>'))}</w:r>`) +
    p(`<w:r>${chart}</w:r>`) +
    p(contentControl + GO_BACK) +
    p(r("Half is ") + fraction),
  rels:
    `<Relationship Id="rIdImage" Type="${OFFICE_RELS}/image" Target="media/image1.png"/>` +
    `<Relationship Id="rIdChart" Type="${OFFICE_RELS}/chart" Target="charts/chart1.xml"/>`,
  media: { "word/media/image1.png": PNG_1PX },
  parts: {
    "word/charts/chart1.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
  },
});

export const WORD_SHAPED: readonly { name: string; bytes: Uint8Array }[] = [
  { name: "resume", bytes: resume },
  { name: "formatting", bytes: formatting },
  { name: "notes", bytes: notes },
  { name: "sections", bytes: sections },
  { name: "objects", bytes: objects },
];
