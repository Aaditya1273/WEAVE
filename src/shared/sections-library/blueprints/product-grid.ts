// WEAVE addition — see src/weave/README.md. Oracle-validated in CI like every
// blueprint (sections-blueprints.test.ts).
import type { SectionBlueprint } from '../types';

// Three-up product grid — tall image tiles, name + price on one baseline,
// no cards or shadows. The archetype of the quiet storefront.
export const productGrid: SectionBlueprint = {
  id: 'product-grid',
  name: 'Product grid',
  category: 'products',
  description: 'Three product tiles with tall imagery and a name / price baseline.',
  fonts: ['Bricolage Grotesque', 'Inter'],
  canvasSize: { width: '1280px', height: '760px' },
  source: `<div data-id="section-product-grid" data-name="Products" style={{
  position: 'relative', order: '0', flex: '0 0 auto',
  width: '100%', height: 'min-content', backgroundColor: '#ffffff',
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
  padding: '96px 46px 96px 46px', gap: '48px'
}}>
  <div data-id="prg-head" data-name="Heading" style={{
    position: 'relative', order: '0', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: '32px', flexWrap: 'wrap'
  }}>
    <p data-id="prg-title" data-name="Title" style={{
      position: 'relative', order: '0', flex: '0 0 auto',
      margin: '0px', width: 'max-content', height: 'auto',
      color: '#161513', fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: '40px', fontWeight: '500', lineHeight: '1.05', letterSpacing: '-0.02em'
    }}>New this season</p>
    <p data-id="prg-link" data-name="View all" style={{
      position: 'relative', order: '1', flex: '0 0 auto',
      margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
      color: 'rgba(22, 21, 19, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '500', lineHeight: '1.4', textDecoration: 'underline', textUnderlineOffset: '4px'
    }}>View the full collection</p>
  </div>
  <div data-id="prg-grid" data-name="Grid" style={{
    position: 'relative', order: '1', flex: '0 0 auto',
    width: '100%', height: 'min-content',
    display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '24px', flexWrap: 'wrap'
  }}>
    <div data-id="prg-item-1" data-name="Product 1" style={{
      position: 'relative', order: '0', flex: '1 0 300px', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '14px'
    }}>
      <div data-id="prg-item-1-image" data-name="Image" role="img" aria-label="Ridge stoneware bowl in oatmeal glaze" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        width: '100%', height: '420px',
        backgroundImage: 'url(https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=900&q=80)',
        backgroundSize: 'cover', backgroundPosition: 'center'
      }}></div>
      <div data-id="prg-item-1-meta" data-name="Meta" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        width: '100%', height: 'min-content',
        display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px'
      }}>
        <p data-id="prg-item-1-name" data-name="Name" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '500', lineHeight: '1.4'
        }}>Ridge stoneware bowl</p>
        <p data-id="prg-item-1-price" data-name="Price" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: 'rgba(22, 21, 19, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.4'
        }}>$68</p>
      </div>
    </div>
    <div data-id="prg-item-2" data-name="Product 2" style={{
      position: 'relative', order: '1', flex: '1 0 300px', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '14px'
    }}>
      <div data-id="prg-item-2-image" data-name="Image" role="img" aria-label="Tall hand-thrown clay vessel" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        width: '100%', height: '420px',
        backgroundImage: 'url(https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=900&q=80)',
        backgroundSize: 'cover', backgroundPosition: 'center'
      }}></div>
      <div data-id="prg-item-2-meta" data-name="Meta" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        width: '100%', height: 'min-content',
        display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px'
      }}>
        <p data-id="prg-item-2-name" data-name="Name" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '500', lineHeight: '1.4'
        }}>Tall clay vessel</p>
        <p data-id="prg-item-2-price" data-name="Price" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: 'rgba(22, 21, 19, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.4'
        }}>$142</p>
      </div>
    </div>
    <div data-id="prg-item-3" data-name="Product 3" style={{
      position: 'relative', order: '2', flex: '1 0 300px', height: 'min-content',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: '14px'
    }}>
      <div data-id="prg-item-3-image" data-name="Image" role="img" aria-label="Set of four ceramic cups" style={{
        position: 'relative', order: '0', flex: '0 0 auto',
        width: '100%', height: '420px',
        backgroundImage: 'url(https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?auto=format&fit=crop&w=900&q=80)',
        backgroundSize: 'cover', backgroundPosition: 'center'
      }}></div>
      <div data-id="prg-item-3-meta" data-name="Meta" style={{
        position: 'relative', order: '1', flex: '0 0 auto',
        width: '100%', height: 'min-content',
        display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px'
      }}>
        <p data-id="prg-item-3-name" data-name="Name" style={{
          position: 'relative', order: '0', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto',
          color: '#161513', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '500', lineHeight: '1.4'
        }}>Set of four cups</p>
        <p data-id="prg-item-3-price" data-name="Price" style={{
          position: 'relative', order: '1', flex: '0 0 auto',
          margin: '0px', width: 'max-content', height: 'auto', whiteSpace: 'nowrap',
          color: 'rgba(22, 21, 19, 0.6)', fontFamily: 'Inter, sans-serif', fontSize: '15px', fontWeight: '400', lineHeight: '1.4'
        }}>$96</p>
      </div>
    </div>
  </div>
</div>`,
};
