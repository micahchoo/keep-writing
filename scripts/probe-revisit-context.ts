// Probe: does a Revisit still read as random once the jar strains furniture
// out and the framing names the Piece?
//
// Before (2026-09-15): the framing was `in 2024` with no title, and a Hugo
// figure shortcode was a legal source. Two arms over the same real blocks
// from Pieces/, through the SHIPPED framingOf and readsAsParagraph:
//   before  the framing as it was, no furniture test
//   after   the framing as it ships, furniture refused before the model runs
//
// Usage: bun run scripts/probe-revisit-context.ts

import { composeRevisit, type BonsaiConfig, type Fetcher } from '../src/bonsai';
import { framingOf, readsAsParagraph } from '../src/paragraphs';

const fetcher: Fetcher = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return { status: res.status, text: await res.text() };
};

const cfg: BonsaiConfig = {
  baseUrl: 'http://127.0.0.1:8088/v1',
  model: 'bonsai-27b',
  fetcher,
  timeoutMs: 120_000,
};

interface Case {
  name: string;
  piece: string;
  title: string;
  year: string;
  publisher?: string;
  heading?: string;
  text: string;
}

const CASES: Case[] = [
  {
    name: 'figure shortcode (pure markup)',
    piece: '2024-01-01-mapping-history-of-cinema',
    title: 'Mapping the history of cinema halls in Hyderabad',
    year: '2024-01-01',
    text: '{{< figure src="e4fe9b0bde5cc60671cde313f37e7f27_MD5.jpeg" alt="Stylized basemap in Mapbox" caption="Stylized basemap in Mapbox" >}}',
  },
  {
    name: 'prose with a ref link',
    piece: '2024-05-01-iiif-images',
    title: 'How to simply set up IIIF images for your small archive',
    year: '2024-05-01',
    text: 'At that time, I was using OpenSeadragon+Annotorious as a way to create the map in [this Compost.mag piece]({{< ref "technofutures-from-bidar" >}}) It felt like magic to be able to path that together with whatever little code I knew, like I had cracked it.',
  },
  {
    name: 'mid-essay prose, no self-context',
    piece: '2024-05-01-iiif-images',
    title: 'How to simply set up IIIF images for your small archive',
    year: '2024-05-01',
    text: 'I started reading up about it and coming back to it every two months. For a non-technical person like me, it was quite a dense topic to understand. So I tried to learn it by saturation and osmosis.',
  },
  {
    name: 'list item with bold lead-in',
    piece: '2024-01-01-mapping-history-of-cinema',
    title: 'Mapping the history of cinema halls in Hyderabad',
    year: '2024-01-01',
    text: '- **Georeferencing in QGIS:** The PNG file was then imported into QGIS, a free and open-source geographic information system, where it was georeferenced to align with geographical data accurately.',
  },
  {
    name: 'bibliography entry',
    piece: '2020-03-01-carefull-collectives',
    title: 'Careful collectives and their care practices',
    year: '2020-03-01',
    heading: 'bibliography',
    text: 'Suchman, Lucy, and NCSAatIllinois. 2018. Relocating Innovation: Places And Practices Of Future Making.',
  },
];

/** The framing as it was before the title went in. */
const wasFraming = (c: Case): string => {
  const when = `in ${c.year.slice(0, 4)}`;
  return c.publisher ? `${when}, for ${c.publisher}` : when;
};

for (const c of CASES) {
  console.log(`\n${'='.repeat(78)}\nCASE  ${c.name}\n${c.piece}\n${'='.repeat(78)}`);

  const before = await composeRevisit(cfg, c.text, wasFraming(c), []);
  console.log(`\n  BEFORE  framing: "${wasFraming(c)}"`);
  if (before.length === 0) console.log('      - nothing offered');
  for (const q of before) console.log(`      * ${q.question}`);

  const framing = framingOf({
    pieceDate: c.year,
    status: 'published',
    title: c.title,
    ...(c.publisher ? { publisher: c.publisher } : {}),
  });
  if (!readsAsParagraph(c.text, c.heading ?? '')) {
    console.log(`\n  AFTER   REFUSED by readsAsParagraph - never reaches the model`);
    continue;
  }
  const after = await composeRevisit(cfg, c.text, framing, []);
  console.log(`\n  AFTER   framing: "${framing}"`);
  if (after.length === 0) console.log('      - nothing offered');
  for (const q of after) console.log(`      * ${q.question}`);
}
