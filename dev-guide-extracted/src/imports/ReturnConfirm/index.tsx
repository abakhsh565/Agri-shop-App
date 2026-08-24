import svgPaths from "./svg-rboskhu39z";

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
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Select Items</p>
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Confirm Return</p>
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

function SummaryHero() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center p-[20px] relative rounded-[12px] shrink-0 w-full" data-name="summary-hero">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Estimated Refund</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[32px] text-black whitespace-nowrap">Rs. 1,400</p>
    </div>
  );
}

function SummaryRow() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[14px] text-black w-full whitespace-nowrap" data-name="summary-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0">Janja Spray 500ml × 1</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 1,400</p>
    </div>
  );
}

function ItemsBox() {
  return (
    <div className="content-stretch flex flex-col items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="items-box">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <SummaryRow />
    </div>
  );
}

function ItemsSummary() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="items-summary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">Returning Items</p>
      <ItemsBox />
    </div>
  );
}

function PillCash() {
  return (
    <div className="bg-black content-stretch flex flex-[1_0_0] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-cash">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-white whitespace-nowrap">Refund Cash</p>
    </div>
  );
}

function PillCredit() {
  return (
    <div className="content-stretch flex flex-[1_0_2px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-credit">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">Credit Note</p>
    </div>
  );
}

function TypePills() {
  return (
    <div className="content-stretch flex gap-[8px] items-start relative shrink-0 w-full" data-name="type-pills">
      <PillCash />
      <PillCredit />
    </div>
  );
}

function ResolutionSelector() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="resolution-selector">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">Resolution Method</p>
      <TypePills />
    </div>
  );
}

function AlertTriangle() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="alert-triangle">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g clipPath="url(#clip0_0_4)" id="alert-triangle">
          <path d={svgPaths.p3a38ad80} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_4">
            <rect fill="white" height="14" width="14" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function IconAlert() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center relative shrink-0 size-[14px]" data-name="icon-alert">
      <AlertTriangle />
    </div>
  );
}

function AlertHeader() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="alert-header">
      <IconAlert />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[11px] text-black uppercase whitespace-nowrap">Refund Processing</p>
    </div>
  );
}

function CreditImpactBox() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="credit-impact-box">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <AlertHeader />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[1.4] min-w-full relative shrink-0 text-[#888] text-[13px] w-[min-content]">Rs. 1,400 will be returned directly to customer Rashid Ali. Original invoice #1042 remains preserved.</p>
    </div>
  );
}

function ConfirmContent() {
  return (
    <div className="content-stretch flex flex-col gap-[24px] items-start p-[24px] relative shrink-0 w-full" data-name="confirm-content">
      <SummaryHero />
      <ItemsSummary />
      <ResolutionSelector />
      <CreditImpactBox />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <ConfirmContent />
    </div>
  );
}

function BtnPrimary() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-primary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Confirm Return</p>
    </div>
  );
}

function ConfirmFooter() {
  return (
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="confirm-footer">
      <BtnPrimary />
    </div>
  );
}

export default function ReturnConfirm() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="return-confirm">
      <Body />
      <ConfirmFooter />
    </div>
  );
}