// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// starter-project.ts — the demo-ready standalone starter: "EMBER", a
// premium storefront composed from the oracle-validated section library
// (hero → products → features → testimonials → FAQ → CTA → footer). Upstream
// seeds a blank single-viewport page for a fresh standalone session; WEAVE
// seeds this instead so a live demo starts on a real site. Everything else
// (about page, CMS collections, tokens, layout) is upstream's default project.

import { createDefaultProject } from '@/code/project/project-fs';
import { getSectionBlueprint } from '@/shared/sections-library';

/** The site's display name, used for the project chip and page metadata. */
export const STARTER_SITE_NAME = 'EMBER';

/** Root id of the starter's hero — the first-run camera focuses it. */
export const STARTER_HERO_ID = 'section-hero-editorial';

const STARTER_SECTIONS = [
  'hero-editorial', 'product-grid', 'features-grid', 'testimonials-cards',
  'faq-list', 'cta-banner', 'footer-columns',
];

/** Same three-viewport `@canvas` block the upstream demo page ships. */
const CANVAS_BLOCK = `/** @canvas {
  "viewports": [
    { "id": "desktop", "label": "Desktop", "width": 1440, "isPrimary": true, "order": 0 },
    { "id": "tablet", "label": "Tablet", "width": 768, "isPrimary": false, "order": 1 },
    { "id": "mobile", "label": "Mobile", "width": 375, "isPrimary": false, "order": 2 }
  ],
  "positions": {
    "desktop": { "x": 0, "y": 0 },
    "tablet": { "x": 1600, "y": 0 },
    "mobile": { "x": 2528, "y": 0 }
  }
} */`;

export function buildStarterPage(): string {
  const sections = STARTER_SECTIONS.map((id, i) => {
    const bp = getSectionBlueprint(id);
    if (!bp) throw new Error(`starter-project: unknown blueprint ${id}`);
    // Each blueprint root declares `order: '0'`; give the page a real flow order.
    return bp.source.replace("order: '0'", `order: '${i}'`);
  });
  return `'use client';

${CANVAS_BLOCK}

import React from 'react';

export default function Page() {
  return (
<div data-id="root" data-name="Page" style={{
  position: 'relative', width: '100%',
  display: 'flex', flexDirection: 'column',
  backgroundColor: '#faf9f7'
}}>
${sections.join('\n')}
</div>
  );
}
`;
}

/** The home route's SERVER half — owns the page metadata Next.js reads. */
const STARTER_PAGE_SERVER = `import PageClient from './page.client';

export const metadata = {
  title: 'EMBER — hand-thrown ceramics',
  description: 'Quietly made stoneware for slow rooms. Hand-thrown in Copenhagen since 2016.',
};

export default function Page() {
  return <PageClient />;
}
`;

/** Upstream default project with the home page swapped for the EMBER starter. */
export function createWeaveStarterProject(): Map<string, string> {
  const files = createDefaultProject();
  files.set('app/page.client.tsx', buildStarterPage());
  files.set('app/page.tsx', STARTER_PAGE_SERVER);
  return files;
}
