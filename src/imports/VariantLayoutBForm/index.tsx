import svgPaths from "./svg-6w6fhjwzvb";

function IosSignal() {
  return (
    <div className="h-[12px] relative shrink-0 w-[18px]" data-name="ios-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="12" preserveAspectRatio="none" viewBox="0 0 18 12" width="18">
        <g id="ios-signal">
          <path clipRule="evenodd" d={svgPaths.p2737f00} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosWifiSignal() {
  return (
    <div className="h-[12px] relative shrink-0 w-[16px]" data-name="ios-wifi-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="12" preserveAspectRatio="none" viewBox="0 0 16 12" width="16">
        <g id="ios-wifi-signal">
          <path clipRule="evenodd" d={svgPaths.p2b23100} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosBatteryFull() {
  return (
    <div className="h-[12px] relative shrink-0 w-[25px]" data-name="ios-battery-full">
      <svg className="absolute block inset-0 size-full" fill="none" height="12" preserveAspectRatio="none" viewBox="0 0 25 12" width="25">
        <g id="ios-battery-full">
          <path d={svgPaths.pde03700} fill="black" id="Vector" />
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
    <div className="content-stretch flex h-[44px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="status-bar">
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

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <ArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Step 1</p>
    </div>
  );
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[52px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[15px] text-black text-center whitespace-nowrap">Var B: Stacked</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Step 2 of 3</p>
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

function Frame() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-black">Pack Sizes</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">Janja Spray (FMC Corporation)</p>
    </div>
  );
}

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">1 Liter Pack</p>
      <p className="font-['Geist:SemiBold',sans-serif] font-semibold relative shrink-0 text-[#888] text-[11px]">Primary Variant</p>
    </div>
  );
}

function Frame4() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Rs. 2,000</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Base Price</p>
      <Frame4 />
    </div>
  );
}

function Frame6() {
  return (
    <div className="bg-white content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0" data-name="Frame">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[6px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Rs. 2,500</p>
    </div>
  );
}

function Frame5() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Selling Price</p>
      <Frame6 />
    </div>
  );
}

function Frame2() {
  return (
    <div className="content-stretch flex gap-[8px] items-start relative shrink-0 w-full" data-name="Frame">
      <Frame3 />
      <Frame5 />
    </div>
  );
}

function Frame8() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">20</p>
    </div>
  );
}

function Frame7() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Initial Stock</p>
      <Frame8 />
    </div>
  );
}

function CardV() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[12px] items-start p-[14px] relative rounded-[12px] shrink-0 w-full" data-name="card-v1">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame1 />
      <Frame2 />
      <Frame7 />
    </div>
  );
}

function Frame9() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">500ml Pack</p>
      <p className="font-['Geist:SemiBold',sans-serif] font-semibold relative shrink-0 text-[#ff3b30] text-[12px]">Remove</p>
    </div>
  );
}

function Frame12() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Rs. 1,000</p>
    </div>
  );
}

function Frame11() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Base Price</p>
      <Frame12 />
    </div>
  );
}

function Frame14() {
  return (
    <div className="bg-white content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0" data-name="Frame">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[6px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Rs. 1,400</p>
    </div>
  );
}

function Frame13() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Selling Price</p>
      <Frame14 />
    </div>
  );
}

function Frame10() {
  return (
    <div className="content-stretch flex gap-[8px] items-start relative shrink-0 w-full" data-name="Frame">
      <Frame11 />
      <Frame13 />
    </div>
  );
}

function Frame16() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">35</p>
    </div>
  );
}

function Frame15() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Initial Stock</p>
      <Frame16 />
    </div>
  );
}

function CardV1() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[12px] items-start p-[14px] relative rounded-[12px] shrink-0 w-full" data-name="card-v2">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame9 />
      <Frame10 />
      <Frame15 />
    </div>
  );
}

function Frame17() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">200ml Pack</p>
      <p className="font-['Geist:SemiBold',sans-serif] font-semibold relative shrink-0 text-[#ff3b30] text-[12px]">Remove</p>
    </div>
  );
}

function Frame20() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Rs. 500</p>
    </div>
  );
}

function Frame19() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Base Price</p>
      <Frame20 />
    </div>
  );
}

function Frame22() {
  return (
    <div className="bg-white content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0" data-name="Frame">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[6px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Rs. 650</p>
    </div>
  );
}

function Frame21() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Selling Price</p>
      <Frame22 />
    </div>
  );
}

function Frame18() {
  return (
    <div className="content-stretch flex gap-[8px] items-start relative shrink-0 w-full" data-name="Frame">
      <Frame19 />
      <Frame21 />
    </div>
  );
}

function Frame24() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex h-[36px] items-center px-[12px] relative rounded-[6px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">10</p>
    </div>
  );
}

function Frame23() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Initial Stock</p>
      <Frame24 />
    </div>
  );
}

function CardV2() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[12px] items-start p-[14px] relative rounded-[12px] shrink-0 w-full" data-name="card-v3">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame17 />
      <Frame18 />
      <Frame23 />
    </div>
  );
}

function StackedCardsList() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-full" data-name="stacked-cards-list">
      <CardV />
      <CardV1 />
      <CardV2 />
    </div>
  );
}

function BtnAddVariant() {
  return (
    <div className="content-stretch flex items-center justify-center px-[24px] py-[12px] relative rounded-[24px] shrink-0 w-full" data-name="btn-add-variant">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">+ Add Variant</p>
    </div>
  );
}

function BodyContent() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[16px] items-start min-h-px p-[16px] relative w-full" data-name="body-content">
      <Frame />
      <StackedCardsList />
      <BtnAddVariant />
    </div>
  );
}

function BtnNext() {
  return (
    <div className="bg-black content-stretch flex h-[44px] items-center justify-center relative rounded-[22px] shrink-0 w-full" data-name="btn-next">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Next Step</p>
    </div>
  );
}

function Footer() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start p-[16px] relative shrink-0 w-full" data-name="footer">
      <div aria-hidden className="absolute border-[#e5e5e5] border-solid border-t inset-0 pointer-events-none" />
      <BtnNext />
    </div>
  );
}

export default function VariantLayoutBForm() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start overflow-clip relative rounded-[16px] shadow-[0px_4px_16px_0px_rgba(0,0,0,0.1)] size-full" data-name="variant-layout-b-form">
      <StatusBar />
      <ScreenHeader />
      <BodyContent />
      <Footer />
    </div>
  );
}