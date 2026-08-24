import svgPaths from "./svg-8kglkltp3r";

function IosSignal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="ios-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="ios-signal">
          <path clipRule="evenodd" d={svgPaths.p2bb6eb80} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosWifiSignal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="ios-wifi-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="ios-wifi-signal">
          <path clipRule="evenodd" d={svgPaths.p646c5c0} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosBatteryFull() {
  return (
    <div className="h-[20px] relative shrink-0 w-[28px]" data-name="ios-battery-full">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 28 20" width="28">
        <g id="ios-battery-full">
          <path d={svgPaths.p66c9640} fill="black" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="status-icons">
      <IosSignal />
      <IosWifiSignal />
      <IosBatteryFull />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="content-stretch flex h-[44px] items-center justify-between px-[24px] relative shrink-0 w-full" data-name="status-bar">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">9:41</p>
      <StatusIcons />
    </div>
  );
}

function ArrowLeft() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="arrow-left">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="arrow-left">
          <path d={svgPaths.pe197860} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconArrowLeft() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[16px]" data-name="icon-arrow-left">
      <ArrowLeft />
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <IconArrowLeft />
    </div>
  );
}

function Frame() {
  return <div className="h-px relative shrink-0 w-[40px]" data-name="Frame" />;
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Product Details</p>
      <Frame />
    </div>
  );
}

function ScreenHeader() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="screen-header">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <HeaderRow />
    </div>
  );
}

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col items-start leading-[normal] min-w-px relative">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[24px] text-black w-full">Janja Spray</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#666] text-[14px] w-full">FMC Corporation</p>
    </div>
  );
}

function CatTab() {
  return (
    <div className="bg-white content-stretch flex items-start px-[16px] py-[8px] relative rounded-[16px] shrink-0" data-name="cat-tab">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Change</p>
    </div>
  );
}

function ProductHero() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-center px-[16px] py-[8px] relative rounded-[8px] shrink-0 w-full" data-name="product-hero">
      <Frame1 />
      <CatTab />
    </div>
  );
}

function VariantInfo() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="variant-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">1 Liter</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Rs. 2,500 — 20 in stock</p>
    </div>
  );
}

function Radio() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="radio">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="radio">
          <rect height="18" rx="9" stroke="black" strokeWidth="2" width="18" x="1" y="1" />
          <circle cx="10" cy="10" fill="black" id="radio-dot" r="5" />
        </g>
      </svg>
    </div>
  );
}

function VariantCard() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="variant-card">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <VariantInfo />
      <Radio />
    </div>
  );
}

function VariantInfo1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="variant-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">500ml</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Rs. 1,400 — 35 in stock</p>
    </div>
  );
}

function Radio1() {
  return (
    <div className="relative rounded-[10px] shrink-0 size-[20px]" data-name="radio">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[10px]" />
    </div>
  );
}

function VariantCard1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="variant-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <VariantInfo1 />
      <Radio1 />
    </div>
  );
}

function VariantInfo2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="variant-info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">200ml</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Rs. 650 — 10 in stock</p>
    </div>
  );
}

function Radio2() {
  return (
    <div className="relative rounded-[10px] shrink-0 size-[20px]" data-name="radio">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[10px]" />
    </div>
  );
}

function VariantCard2() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="variant-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <VariantInfo2 />
      <Radio2 />
    </div>
  );
}

function VariantSelection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-full" data-name="variant-selection">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase whitespace-nowrap">Select Variant</p>
      <VariantCard />
      <VariantCard1 />
      <VariantCard2 />
    </div>
  );
}

function BtnMinus() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="btn-minus">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[18px] text-black whitespace-nowrap">-</p>
    </div>
  );
}

function BtnPlus() {
  return (
    <div className="bg-black content-stretch flex flex-col items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="btn-plus">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[18px] text-white whitespace-nowrap">+</p>
    </div>
  );
}

function StepperControls() {
  return (
    <div className="content-stretch flex h-[48px] items-center justify-between px-[4px] relative rounded-[24px] shrink-0 w-full" data-name="stepper-controls">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <BtnMinus />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">3</p>
      <BtnPlus />
    </div>
  );
}

function QuantityStepper() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-full" data-name="quantity-stepper">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase whitespace-nowrap">Quantity</p>
      <StepperControls />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">35 remaining in stock</p>
    </div>
  );
}

function VariantsContent() {
  return (
    <div className="content-stretch flex flex-col gap-[24px] items-start p-[24px] relative shrink-0 w-full" data-name="variants-content">
      <ProductHero />
      <VariantSelection />
      <QuantityStepper />
    </div>
  );
}

function VariantsBody() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="variants-body">
      <StatusBar />
      <ScreenHeader />
      <VariantsContent />
    </div>
  );
}

function BtnPrimary() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-primary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Add to Cart</p>
    </div>
  );
}

function VariantsFooter() {
  return (
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="variants-footer">
      <BtnPrimary />
    </div>
  );
}

export default function NewSaleProductVariants() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="new-sale-product-variants">
      <VariantsBody />
      <VariantsFooter />
    </div>
  );
}