// WEAVE addition — see src/weave/README.md. Oracle-validated in CI like every
// blueprint (sections-blueprints.test.ts).
import type { SectionBlueprint } from '../types';

// Call-to-action banner — full-bleed ink block, one line of display type,
// one supporting sentence, one button. The section that closes an argument.
export const ctaBanner: SectionBlueprint = {
  id: 'cta-banner',
  name: 'Call to action',
  category: 'cta',
  description: 'Inverted full-width banner with a single headline and button.',
  fonts: ['Bricolage Grotesque', 'Inter'],
  canvasSize: { width: '1280px', height: '420px' },
  source: `<div data-id="section-cta" data-name="Call to action" style={{
  position: 'relative', order: '0', flex: '0 0 auto',
  width: '100%', height: 'min-content', backgroundColor: '#161513',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '112px 46px 112px 46px', gap: '28px'
}}>
  <p data-id="cta-title" data-name="Title" style={{
    position: 'relative', order: '0', flex: '0 0 auto',
    margin: '0px', width: '100%', maxWidth: '760px', height: 'auto', textAlign: 'center',
    color: '#ffffff', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '52px', fontWeight: '500', lineHeight: '1', letterSpacing: '-0.03em'
  }}>Bring something lasting into the room</p>
  <p data-id="cta-lead" data-name="Lead" style={{
    position: 'relative', order: '1', flex: '0 0 auto',
    margin: '0px', width: '100%', maxWidth: '520px', height: 'auto', textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '17px', fontWeight: '400', lineHeight: '1.55'
  }}>Browse the current collection or write to us about a commission.</p>
  <div data-id="cta-button" data-name="Button" style={{
    position: 'relative', order: '2', flex: '0 0 auto',
    width: 'min-content', height: 'min-content', marginTop: '8px',
    display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: '14px 28px 14px 28px', backgroundColor: '#ffffff'
  }}>
    <p data-id="cta-button-label" data-name="Label" style={{
      position: 'relative', order: '0', flex: '0 0 auto',
      margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
      color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '500', lineHeight: '1.4'
    }}>Shop the collection</p>
  </div>
</div>`,
};
