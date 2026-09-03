// WEAVE addition — see src/weave/README.md. Oracle-validated in CI like every
// blueprint (sections-blueprints.test.ts).
import type { SectionBlueprint } from '../types';

// Contact — no form, just the three ways to reach a small studio laid out
// as columns with monospace labels. Forms come from the form builder when
// the user wants one; this section is the calm default.
export const contactPanel: SectionBlueprint = {
  id: 'contact-panel',
  name: 'Contact',
  category: 'contact',
  description: 'Heading plus email, studio address and hours in three quiet columns.',
  fonts: ['Bricolage Grotesque', 'Inter'],
  canvasSize: { width: '1280px', height: '460px' },
  source: `<div data-id="section-contact" data-name="Contact" style={{
  position: 'relative', order: '0', flex: '0 0 auto',
  width: '100%', height: 'min-content', backgroundColor: '#ffffff',
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
  padding: '96px 46px 96px 46px', gap: '48px'
}}>
  <p data-id="cnt-title" data-name="Title" style={{
    position: 'relative', order: '0', flex: '0 0 auto',
    margin: '0px', width: '100%', maxWidth: '620px', height: 'auto',
    color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '40px', fontWeight: '500', lineHeight: '1.05', letterSpacing: '-0.02em'
  }}>Visit the studio or write to us</p>
  <div data-id="cnt-columns" data-name="Columns" style={{
    position: 'relative', order: '1', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '48px', flexWrap: 'wrap'
  }}>
    <div data-id="cnt-col-1" data-name="Email" style={{
      position: 'relative', order: '0', flex: '1 0 220px', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '10px',
      padding: '20px 0px 0px 0px', borderTop: '1px solid rgba(22, 21, 19, 0.14)'
    }}>
      <p data-id="cnt-col-1-label" data-name="Label" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(22, 21, 19, 0.5)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
      }}>EMAIL</p>
      <p data-id="cnt-col-1-value" data-name="Value" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '18px', fontWeight: '500', lineHeight: '1.4'
      }}>hello@ember.studio</p>
    </div>
    <div data-id="cnt-col-2" data-name="Address" style={{
      position: 'relative', order: '1', flex: '1 0 220px', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '10px',
      padding: '20px 0px 0px 0px', borderTop: '1px solid rgba(22, 21, 19, 0.14)'
    }}>
      <p data-id="cnt-col-2-label" data-name="Label" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(22, 21, 19, 0.5)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
      }}>STUDIO</p>
      <p data-id="cnt-col-2-value" data-name="Value" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '18px', fontWeight: '500', lineHeight: '1.4'
      }}>14 Kiln Lane, Copenhagen K</p>
    </div>
    <div data-id="cnt-col-3" data-name="Hours" style={{
      position: 'relative', order: '2', flex: '1 0 220px', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '10px',
      padding: '20px 0px 0px 0px', borderTop: '1px solid rgba(22, 21, 19, 0.14)'
    }}>
      <p data-id="cnt-col-3-label" data-name="Label" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(22, 21, 19, 0.5)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
      }}>HOURS</p>
      <p data-id="cnt-col-3-value" data-name="Value" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '18px', fontWeight: '500', lineHeight: '1.4'
      }}>Tue – Sat, 10:00 – 18:00</p>
    </div>
  </div>
</div>`,
};
