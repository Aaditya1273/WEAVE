// WEAVE addition — see src/weave/README.md. Oracle-validated in CI like every
// blueprint (sections-blueprints.test.ts).
import type { SectionBlueprint } from '../types';

// FAQ — a two-column editorial layout: sticky-feeling heading on the left,
// hairline-separated question / answer pairs on the right. Static (no
// accordion) so every answer is visible and editable on the canvas.
export const faqList: SectionBlueprint = {
  id: 'faq-list',
  name: 'FAQ list',
  category: 'faq',
  description: 'Two-column FAQ with hairline-separated question and answer pairs.',
  fonts: ['Bricolage Grotesque', 'Inter'],
  canvasSize: { width: '1280px', height: '620px' },
  source: `<div data-id="section-faq" data-name="FAQ" style={{
  position: 'relative', order: '0', flex: '0 0 auto',
  width: '100%', height: 'min-content', backgroundColor: '#faf9f7',
  display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-start',
  padding: '96px 46px 96px 46px', gap: '64px', flexWrap: 'wrap'
}}>
  <div data-id="faq-head" data-name="Heading" style={{
    position: 'relative', order: '0', flex: '1 0 280px', maxWidth: '380px', height: 'min-content',
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '14px'
  }}>
    <p data-id="faq-title" data-name="Title" style={{
      position: 'relative', order: '0', flex: '0 0 auto',
      margin: '0px', width: '100%', height: 'auto',
      color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '40px', fontWeight: '500', lineHeight: '1.05', letterSpacing: '-0.02em'
    }}>Questions, answered</p>
    <p data-id="faq-lead" data-name="Lead" style={{
      position: 'relative', order: '1', flex: '0 0 auto',
      margin: '0px', width: '100%', height: 'auto',
      color: 'rgba(22, 21, 19, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.6'
    }}>Anything missing? Write to us and we will answer within a day.</p>
  </div>
  <div data-id="faq-list" data-name="List" style={{
    position: 'relative', order: '1', flex: '2 0 420px', height: 'min-content',
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start'
  }}>
    <div data-id="faq-item-1" data-name="Question 1" style={{
      position: 'relative', order: '0', flex: '0 0 auto',
      width: '100%', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '10px',
      padding: '24px 0px 24px 0px', borderTop: '1px solid rgba(22, 21, 19, 0.14)'
    }}>
      <p data-id="faq-item-1-q" data-name="Question" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '20px', fontWeight: '500', lineHeight: '1.3'
      }}>How long does an order take?</p>
      <p data-id="faq-item-1-a" data-name="Answer" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(22, 21, 19, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.6'
      }}>Stocked pieces ship within three working days. Made-to-order work takes four to six weeks, and we send photos before firing.</p>
    </div>
    <div data-id="faq-item-2" data-name="Question 2" style={{
      position: 'relative', order: '1', flex: '0 0 auto',
      width: '100%', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '10px',
      padding: '24px 0px 24px 0px', borderTop: '1px solid rgba(22, 21, 19, 0.14)'
    }}>
      <p data-id="faq-item-2-q" data-name="Question" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '20px', fontWeight: '500', lineHeight: '1.3'
      }}>Do you ship internationally?</p>
      <p data-id="faq-item-2-a" data-name="Answer" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(22, 21, 19, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.6'
      }}>Yes, to most countries. Duties are calculated at checkout so there are no surprises at the door.</p>
    </div>
    <div data-id="faq-item-3" data-name="Question 3" style={{
      position: 'relative', order: '2', flex: '0 0 auto',
      width: '100%', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '10px',
      padding: '24px 0px 24px 0px', borderTop: '1px solid rgba(22, 21, 19, 0.14)', borderBottom: '1px solid rgba(22, 21, 19, 0.14)'
    }}>
      <p data-id="faq-item-3-q" data-name="Question" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '20px', fontWeight: '500', lineHeight: '1.3'
      }}>What if a piece arrives damaged?</p>
      <p data-id="faq-item-3-a" data-name="Answer" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(22, 21, 19, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.6'
      }}>Send us a photo and we replace it, no forms. Keep the piece; kintsugi is a fine second life.</p>
    </div>
  </div>
</div>`,
};
