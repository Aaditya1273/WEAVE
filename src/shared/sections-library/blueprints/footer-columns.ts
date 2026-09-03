// WEAVE addition — see src/weave/README.md. Oracle-validated in CI like every
// blueprint (sections-blueprints.test.ts).
import type { SectionBlueprint } from '../types';

// Footer — ink block with the wordmark on the left and three link columns on
// the right, closed by a hairline legal row. Links are text nodes so the
// Link tool can wire destinations per project.
export const footerColumns: SectionBlueprint = {
  id: 'footer-columns',
  name: 'Footer',
  category: 'footer',
  description: 'Dark footer with wordmark, three link columns and a legal row.',
  fonts: ['Bricolage Grotesque', 'Inter'],
  canvasSize: { width: '1280px', height: '420px' },
  source: `<div data-id="section-footer" data-name="Footer" style={{
  position: 'relative', order: '0', flex: '0 0 auto',
  width: '100%', height: 'min-content', backgroundColor: '#161513',
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
  padding: '72px 46px 36px 46px', gap: '56px'
}}>
  <div data-id="ftr-top" data-name="Top row" style={{
    position: 'relative', order: '0', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: '48px', flexWrap: 'wrap'
  }}>
    <div data-id="ftr-brand" data-name="Brand" style={{
      position: 'relative', order: '0', flex: '1 0 260px', maxWidth: '380px', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '14px'
    }}>
      <p data-id="ftr-wordmark" data-name="Wordmark" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: '#ffffff', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '28px', fontWeight: '500', lineHeight: '1', letterSpacing: '-0.02em'
      }}>EMBER</p>
      <p data-id="ftr-tagline" data-name="Tagline" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(255, 255, 255, 0.55)', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.6'
      }}>Objects for slow rooms. Made by hand in Copenhagen since 2016.</p>
    </div>
    <div data-id="ftr-links" data-name="Link columns" style={{
      position: 'relative', order: '1', flex: '0 0 auto',
      width: 'min-content', height: 'min-content',
      display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '64px', flexWrap: 'wrap'
    }}>
      <div data-id="ftr-col-1" data-name="Shop" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        width: 'min-content', height: 'min-content',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '12px'
      }}>
        <p data-id="ftr-col-1-title" data-name="Title" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap', marginBottom: '6px',
          color: 'rgba(255, 255, 255, 0.45)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
        }}>SHOP</p>
        <p data-id="ftr-col-1-link-1" data-name="Link" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>New arrivals</p>
        <p data-id="ftr-col-1-link-2" data-name="Link" style={{
          position: 'relative', order: '2', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>Tableware</p>
        <p data-id="ftr-col-1-link-3" data-name="Link" style={{
          position: 'relative', order: '3', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>Commissions</p>
      </div>
      <div data-id="ftr-col-2" data-name="Studio" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        width: 'min-content', height: 'min-content',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '12px'
      }}>
        <p data-id="ftr-col-2-title" data-name="Title" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap', marginBottom: '6px',
          color: 'rgba(255, 255, 255, 0.45)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
        }}>STUDIO</p>
        <p data-id="ftr-col-2-link-1" data-name="Link" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>About</p>
        <p data-id="ftr-col-2-link-2" data-name="Link" style={{
          position: 'relative', order: '2', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>Journal</p>
        <p data-id="ftr-col-2-link-3" data-name="Link" style={{
          position: 'relative', order: '3', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>Visit</p>
      </div>
      <div data-id="ftr-col-3" data-name="Help" style={{
        position: 'relative', order: '2', flex: '0 0 auto',
        width: 'min-content', height: 'min-content',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '12px'
      }}>
        <p data-id="ftr-col-3-title" data-name="Title" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap', marginBottom: '6px',
          color: 'rgba(255, 255, 255, 0.45)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', fontWeight: '400', lineHeight: '1.6', letterSpacing: '1px'
        }}>HELP</p>
        <p data-id="ftr-col-3-link-1" data-name="Link" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>Shipping</p>
        <p data-id="ftr-col-3-link-2" data-name="Link" style={{
          position: 'relative', order: '2', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>Returns</p>
        <p data-id="ftr-col-3-link-3" data-name="Link" style={{
          position: 'relative', order: '3', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5'
        }}>Contact</p>
      </div>
    </div>
  </div>
  <div data-id="ftr-legal" data-name="Legal row" style={{
    position: 'relative', order: '1', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap',
    padding: '20px 0px 0px 0px', borderTop: '1px solid rgba(255, 255, 255, 0.14)'
  }}>
    <p data-id="ftr-copyright" data-name="Copyright" style={{
      position: 'relative', order: '0', flex: '0 0 auto',
      margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
      color: 'rgba(255, 255, 255, 0.45)', fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: '400', lineHeight: '1.5'
    }}>© 2026 EMBER. All rights reserved.</p>
    <p data-id="ftr-built" data-name="Built with" style={{
      position: 'relative', order: '1', flex: '0 0 auto',
      margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
      color: 'rgba(255, 255, 255, 0.45)', fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: '400', lineHeight: '1.5'
    }}>Built with WEAVE — by humans and agents</p>
  </div>
</div>`,
};
