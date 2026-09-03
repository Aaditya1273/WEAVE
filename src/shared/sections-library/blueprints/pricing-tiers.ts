// WEAVE addition — see src/weave/README.md. Oracle-validated in CI like every
// blueprint (sections-blueprints.test.ts).
import type { SectionBlueprint } from '../types';

// Three pricing tiers — the middle tier inverts to ink so it reads as the
// recommendation without a badge. Feature rows are plain text lines.
export const pricingTiers: SectionBlueprint = {
  id: 'pricing-tiers',
  name: 'Pricing tiers',
  category: 'pricing',
  description: 'Three tiers with an inverted featured plan and a single call to action each.',
  fonts: ['Bricolage Grotesque', 'Inter'],
  canvasSize: { width: '1280px', height: '720px' },
  source: `<div data-id="section-pricing" data-name="Pricing" style={{
  position: 'relative', order: '0', flex: '0 0 auto',
  width: '100%', height: 'min-content', backgroundColor: '#ffffff',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
  padding: '96px 46px 96px 46px', gap: '48px'
}}>
  <div data-id="prc-head" data-name="Heading" style={{
    position: 'relative', order: '0', flex: '0 0 auto',
    width: '100%', maxWidth: '640px', height: 'min-content',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: '12px'
  }}>
    <p data-id="prc-title" data-name="Title" style={{
      position: 'relative', order: '0', flex: '0 0 auto',
      margin: '0px', width: '100%', height: 'auto', textAlign: 'center',
      color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '40px', fontWeight: '500', lineHeight: '1.05', letterSpacing: '-0.02em'
    }}>Simple, honest pricing</p>
    <p data-id="prc-lead" data-name="Lead" style={{
      position: 'relative', order: '1', flex: '0 0 auto',
      margin: '0px', width: '100%', height: 'auto', textAlign: 'center',
      color: 'rgba(22, 21, 19, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '16px', fontWeight: '400', lineHeight: '1.6'
    }}>No tiers hidden behind a sales call. Pick one, change any time.</p>
  </div>
  <div data-id="prc-grid" data-name="Tiers" style={{
    position: 'relative', order: '1', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'row', justifyContent: 'center', gap: '20px', flexWrap: 'wrap'
  }}>
    <div data-id="prc-tier-1" data-name="Starter" style={{
      position: 'relative', order: '0', flex: '1 0 280px', maxWidth: '380px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '20px',
      padding: '32px 28px 32px 28px', border: '1px solid rgba(22, 21, 19, 0.12)', backgroundColor: '#ffffff'
    }}>
      <p data-id="prc-tier-1-name" data-name="Name" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(22, 21, 19, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: '500', lineHeight: '1.4', letterSpacing: '0.5px'
      }}>STARTER</p>
      <p data-id="prc-tier-1-price" data-name="Price" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '44px', fontWeight: '500', lineHeight: '1', letterSpacing: '-0.02em'
      }}>$0</p>
      <p data-id="prc-tier-1-desc" data-name="Description" style={{
        position: 'relative', order: '2', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(22, 21, 19, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.6'
      }}>One site, community support, WEAVE badge on the footer.</p>
      <div data-id="prc-tier-1-cta" data-name="Button" style={{
        position: 'relative', order: '3', flex: '0 0 auto',
        width: '100%', height: 'min-content', marginTop: '8px',
        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        padding: '12px 20px 12px 20px', border: '1px solid #161513'
      }}>
        <p data-id="prc-tier-1-cta-label" data-name="Label" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '500', lineHeight: '1.4'
        }}>Start free</p>
      </div>
    </div>
    <div data-id="prc-tier-2" data-name="Studio" style={{
      position: 'relative', order: '1', flex: '1 0 280px', maxWidth: '380px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '20px',
      padding: '32px 28px 32px 28px', backgroundColor: '#161513'
    }}>
      <p data-id="prc-tier-2-name" data-name="Name" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(255, 255, 255, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: '500', lineHeight: '1.4', letterSpacing: '0.5px'
      }}>STUDIO</p>
      <p data-id="prc-tier-2-price" data-name="Price" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: '#ffffff', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '44px', fontWeight: '500', lineHeight: '1', letterSpacing: '-0.02em'
      }}>$24 / mo</p>
      <p data-id="prc-tier-2-desc" data-name="Description" style={{
        position: 'relative', order: '2', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(255, 255, 255, 0.7)', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.6'
      }}>Unlimited sites, custom domains, agent collaboration, priority help.</p>
      <div data-id="prc-tier-2-cta" data-name="Button" style={{
        position: 'relative', order: '3', flex: '0 0 auto',
        width: '100%', height: 'min-content', marginTop: '8px',
        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        padding: '12px 20px 12px 20px', backgroundColor: '#ffffff'
      }}>
        <p data-id="prc-tier-2-cta-label" data-name="Label" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '500', lineHeight: '1.4'
        }}>Choose Studio</p>
      </div>
    </div>
    <div data-id="prc-tier-3" data-name="Agency" style={{
      position: 'relative', order: '2', flex: '1 0 280px', maxWidth: '380px', height: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '20px',
      padding: '32px 28px 32px 28px', border: '1px solid rgba(22, 21, 19, 0.12)', backgroundColor: '#ffffff'
    }}>
      <p data-id="prc-tier-3-name" data-name="Name" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: 'rgba(22, 21, 19, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: '500', lineHeight: '1.4', letterSpacing: '0.5px'
      }}>AGENCY</p>
      <p data-id="prc-tier-3-price" data-name="Price" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
        color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '44px', fontWeight: '500', lineHeight: '1', letterSpacing: '-0.02em'
      }}>$79 / mo</p>
      <p data-id="prc-tier-3-desc" data-name="Description" style={{
        position: 'relative', order: '2', flex: '0 0 auto',
        margin: '0px', width: '100%', height: 'auto',
        color: 'rgba(22, 21, 19, 0.65)', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.6'
      }}>Client workspaces, shared components, approvals and hand-off.</p>
      <div data-id="prc-tier-3-cta" data-name="Button" style={{
        position: 'relative', order: '3', flex: '0 0 auto',
        width: '100%', height: 'min-content', marginTop: '8px',
        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        padding: '12px 20px 12px 20px', border: '1px solid #161513'
      }}>
        <p data-id="prc-tier-3-cta-label" data-name="Label" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '500', lineHeight: '1.4'
        }}>Talk to us</p>
      </div>
    </div>
  </div>
</div>`,
};
