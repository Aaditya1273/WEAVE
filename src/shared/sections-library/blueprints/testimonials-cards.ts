// WEAVE addition — see src/weave/README.md. Oracle-validated in CI like every
// blueprint (sections-blueprints.test.ts).
import type { SectionBlueprint } from '../types';

// Three testimonial cards — large opening quote glyph, the quote, then a
// name / role baseline. Dark ink on paper; the cards are keylined, not
// shadowed, so the section stays flat and editorial.
export const testimonialsCards: SectionBlueprint = {
  id: 'testimonials-cards',
  name: 'Testimonials',
  category: 'testimonials',
  description: 'Three keylined quote cards with name and role.',
  fonts: ['Bricolage Grotesque', 'Inter'],
  canvasSize: { width: '1280px', height: '560px' },
  source: `<div data-id="section-testimonials" data-name="Testimonials" style={{
  position: 'relative', order: '0', flex: '0 0 auto',
  width: '100%', height: 'min-content', backgroundColor: '#faf9f7',
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
  padding: '96px 46px 96px 46px', gap: '48px'
}}>
  <p data-id="tst-title" data-name="Title" style={{
    position: 'relative', order: '0', flex: '0 0 auto',
    margin: '0px', width: '100%', maxWidth: '620px', height: 'auto',
    color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '40px', fontWeight: '500', lineHeight: '1.05', letterSpacing: '-0.02em'
  }}>Kind words from people who live with the work</p>
  <div data-id="tst-grid" data-name="Grid" style={{
    position: 'relative', order: '1', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', gap: '24px', flexWrap: 'wrap'
  }}>
    <div data-id="tst-card-1" data-name="Quote 1" style={{
      position: 'relative', order: '0', flex: '1 0 300px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', gap: '28px',
      padding: '32px 28px 32px 28px', border: '1px solid rgba(22, 21, 19, 0.12)', backgroundColor: '#ffffff'
    }}>
      <p data-id="tst-card-1-quote" data-name="Quote" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '20px', fontWeight: '400', lineHeight: '1.45'
      }}>“The bowls arrived wrapped in linen with a handwritten note. I have not bought from anyone else since.”</p>
      <div data-id="tst-card-1-author" data-name="Author" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        width: '100%', height: 'min-content',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '2px'
      }}>
        <p data-id="tst-card-1-name" data-name="Name" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '600', lineHeight: '1.4'
        }}>Mara Lindqvist</p>
        <p data-id="tst-card-1-role" data-name="Role" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: 'rgba(22, 21, 19, 0.55)', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: '400', lineHeight: '1.4'
        }}>Chef, Malmö</p>
      </div>
    </div>
    <div data-id="tst-card-2" data-name="Quote 2" style={{
      position: 'relative', order: '1', flex: '1 0 300px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', gap: '28px',
      padding: '32px 28px 32px 28px', border: '1px solid rgba(22, 21, 19, 0.12)', backgroundColor: '#ffffff'
    }}>
      <p data-id="tst-card-2-quote" data-name="Quote" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '20px', fontWeight: '400', lineHeight: '1.45'
      }}>“Restraint you can feel. Every piece is exactly as much as it needs to be.”</p>
      <div data-id="tst-card-2-author" data-name="Author" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        width: '100%', height: 'min-content',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '2px'
      }}>
        <p data-id="tst-card-2-name" data-name="Name" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '600', lineHeight: '1.4'
        }}>Tomas Reyes</p>
        <p data-id="tst-card-2-role" data-name="Role" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: 'rgba(22, 21, 19, 0.55)', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: '400', lineHeight: '1.4'
        }}>Interior architect</p>
      </div>
    </div>
    <div data-id="tst-card-3" data-name="Quote 3" style={{
      position: 'relative', order: '2', flex: '1 0 300px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', gap: '28px',
      padding: '32px 28px 32px 28px', border: '1px solid rgba(22, 21, 19, 0.12)', backgroundColor: '#ffffff'
    }}>
      <p data-id="tst-card-3-quote" data-name="Quote" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '20px', fontWeight: '400', lineHeight: '1.45'
      }}>“We furnished the whole studio from one order. Three years on, it all still looks new.”</p>
      <div data-id="tst-card-3-author" data-name="Author" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        width: '100%', height: 'min-content',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '2px'
      }}>
        <p data-id="tst-card-3-name" data-name="Name" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '600', lineHeight: '1.4'
        }}>Priya Anand</p>
        <p data-id="tst-card-3-role" data-name="Role" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: 'rgba(22, 21, 19, 0.55)', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: '400', lineHeight: '1.4'
        }}>Founder, Kiln Studio</p>
      </div>
    </div>
  </div>
</div>`,
};
