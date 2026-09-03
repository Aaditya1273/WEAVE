// WEAVE addition — see src/weave/README.md. Oracle-validated in CI like every
// blueprint (sections-blueprints.test.ts).
import type { SectionBlueprint } from '../types';

// Three-up feature grid — quiet editorial cards on warm paper, hairline
// keylines instead of shadows. The numbered eyebrows keep scan order obvious.
export const featuresGrid: SectionBlueprint = {
  id: 'features-grid',
  name: 'Feature grid',
  category: 'features',
  description: 'Three-column feature grid with numbered eyebrows on warm paper.',
  fonts: ['Bricolage Grotesque', 'Inter'],
  canvasSize: { width: '1280px', height: '640px' },
  source: `<div data-id="section-features-grid" data-name="Features" style={{
  position: 'relative', order: '0', flex: '0 0 auto',
  width: '100%', height: 'min-content', backgroundColor: '#faf9f7',
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
  padding: '96px 46px 96px 46px', gap: '56px'
}}>
  <div data-id="ftg-head" data-name="Heading" style={{
    position: 'relative', order: '0', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '14px'
  }}>
    <p data-id="ftg-eyebrow" data-name="Eyebrow" style={{
      position: 'relative', order: '0', flex: '0 0 auto',
      margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
      color: 'rgba(22, 21, 19, 0.55)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', fontWeight: '400', lineHeight: '1.7', letterSpacing: '1px'
    }}>WHAT WE DO</p>
    <p data-id="ftg-title" data-name="Title" style={{
      position: 'relative', order: '1', flex: '0 0 auto',
      margin: '0px', width: '100%', maxWidth: '640px', height: 'auto',
      color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '44px', fontWeight: '500', lineHeight: '1.05', letterSpacing: '-0.02em'
    }}>Everything a small studio needs, nothing it doesn't</p>
  </div>
  <div data-id="ftg-grid" data-name="Grid" style={{
    position: 'relative', order: '1', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', gap: '28px', flexWrap: 'wrap'
  }}>
    <div data-id="ftg-card-1" data-name="Feature 1" style={{
      position: 'relative', order: '0', flex: '1 0 280px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '16px',
      padding: '28px 24px 32px 24px', border: '1px solid rgba(22, 21, 19, 0.12)'
    }}>
      <p data-id="ftg-card-1-num" data-name="Number" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(22, 21, 19, 0.4)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
      }}>01</p>
      <p data-id="ftg-card-1-title" data-name="Title" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '22px', fontWeight: '500', lineHeight: '1.2'
      }}>Considered design</p>
      <p data-id="ftg-card-1-body" data-name="Body" style={{
        position: 'relative', order: '2', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(22, 21, 19, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.6'
      }}>Every surface starts from what it must say, not what it could show. We remove until it reads.</p>
    </div>
    <div data-id="ftg-card-2" data-name="Feature 2" style={{
      position: 'relative', order: '1', flex: '1 0 280px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '16px',
      padding: '28px 24px 32px 24px', border: '1px solid rgba(22, 21, 19, 0.12)'
    }}>
      <p data-id="ftg-card-2-num" data-name="Number" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(22, 21, 19, 0.4)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
      }}>02</p>
      <p data-id="ftg-card-2-title" data-name="Title" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '22px', fontWeight: '500', lineHeight: '1.2'
      }}>Durable materials</p>
      <p data-id="ftg-card-2-body" data-name="Body" style={{
        position: 'relative', order: '2', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(22, 21, 19, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.6'
      }}>Clay, oak, linen, stoneware. Materials that age into character instead of out of fashion.</p>
    </div>
    <div data-id="ftg-card-3" data-name="Feature 3" style={{
      position: 'relative', order: '2', flex: '1 0 280px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '16px',
      padding: '28px 24px 32px 24px', border: '1px solid rgba(22, 21, 19, 0.12)'
    }}>
      <p data-id="ftg-card-3-num" data-name="Number" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(22, 21, 19, 0.4)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
      }}>03</p>
      <p data-id="ftg-card-3-title" data-name="Title" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '22px', fontWeight: '500', lineHeight: '1.2'
      }}>Honest process</p>
      <p data-id="ftg-card-3-body" data-name="Body" style={{
        position: 'relative', order: '2', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(22, 21, 19, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.6'
      }}>One maker per piece, start to finish. You always know whose hands your work passed through.</p>
    </div>
  </div>
</div>`,
};
