import svgPaths from "./svg-6ropiku7mv";

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
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Sale #1042</p>
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Process Return</p>
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

function SaleDetails() {
  return (
    <div className="content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-start justify-between relative shrink-0 text-[#888] text-[13px] w-full" data-name="sale-details">
      <p className="relative shrink-0">Rashid Ali</p>
      <p className="relative shrink-0">Aug 8, 2026</p>
    </div>
  );
}

function OriginalSaleBanner() {
  return (
    <div className="[word-break:break-word] bg-[#f5f5f5] content-stretch flex flex-col gap-[4px] items-start leading-[normal] p-[16px] relative shrink-0 w-full whitespace-nowrap" data-name="original-sale-banner">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Sale #1042</p>
      <SaleDetails />
    </div>
  );
}

function TextLeft() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="text-left">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Janja Spray 500ml</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">3 purchased · Rs. 1,400 each</p>
    </div>
  );
}

function ItemInfo() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="item-info">
      <TextLeft />
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Rs. 4,200</p>
    </div>
  );
}

function Action() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="Action">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="Action">
          <path d={svgPaths.p16b6ae00} fill="#FFEDED" />
          <path d={svgPaths.p20ef8e00} id="Vector" stroke="#C32A0B" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function Action1() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="Action">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="Action">
          <path d={svgPaths.p16b6ae00} fill="#F0F3F4" />
          <path d="M11 16H21M16 11V21" id="Vector" stroke="black" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function QuantitySelector() {
  return (
    <div className="content-stretch flex items-center justify-between p-[2px] relative rounded-[34px] shrink-0 w-[112px]" data-name="Quantity selector">
      <div aria-hidden className="absolute border border-[#f2f4f5] border-solid inset-0 pointer-events-none rounded-[34px]" />
      <Action />
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">2</p>
      <Action1 />
    </div>
  );
}

function QuantityCounterSelector() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full" data-name="quantity-counter-selector">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">Qty to return:</p>
      <QuantitySelector />
    </div>
  );
}

function ReturnRow() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="return-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <ItemInfo />
      <QuantityCounterSelector />
    </div>
  );
}

function TextLeft1() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="text-left">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Wheat Seeds 5kg</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">1 bag purchased · Rs. 5,000 each</p>
    </div>
  );
}

function ItemInfo1() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="item-info">
      <TextLeft1 />
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Rs. 5,000</p>
    </div>
  );
}

function Action2() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="Action">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="Action">
          <path d={svgPaths.p16b6ae00} fill="#F0F3F4" />
          <path d="M11 16H21" id="Vector" stroke="black" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function Action3() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="Action">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="Action">
          <path d={svgPaths.p16b6ae00} fill="#F0F3F4" />
          <path d="M11 16H21M16 11V21" id="Vector" stroke="black" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function QuantitySelector1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[2px] relative rounded-[34px] shrink-0 w-[112px]" data-name="Quantity selector">
      <div aria-hidden className="absolute border border-[#f2f4f5] border-solid inset-0 pointer-events-none rounded-[34px]" />
      <Action2 />
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">2</p>
      <Action3 />
    </div>
  );
}

function QuantityCounterSelector1() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full" data-name="quantity-counter-selector">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">Qty to return:</p>
      <QuantitySelector1 />
    </div>
  );
}

function ReturnRow1() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="return-row">
      <ItemInfo1 />
      <QuantityCounterSelector1 />
    </div>
  );
}

function ItemsForReturnList() {
  return (
    <div className="relative rounded-[12px] shrink-0 w-full" data-name="items-for-return-list">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <ReturnRow />
        <ReturnRow1 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-center justify-between leading-[normal] relative shrink-0 text-black w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[14px]">Return Total</p>
      <p className="relative shrink-0 text-[18px]">Rs. 1,400</p>
    </div>
  );
}

function ReceiptSummary() {
  return (
    <div className="content-stretch flex flex-col items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="receipt-summary">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame1 />
    </div>
  );
}

function ReturnItemsContent() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="return-items-content">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">{`Select Items & Quantity to Return`}</p>
      <ItemsForReturnList />
      <ReceiptSummary />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <OriginalSaleBanner />
      <ReturnItemsContent />
    </div>
  );
}

function BtnPrimary() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-primary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Next</p>
    </div>
  );
}

function FooterButtonWrapper() {
  return (
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="footer-button-wrapper">
      <BtnPrimary />
    </div>
  );
}

export default function ReturnSelectItems() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="return-select-items">
      <Body />
      <FooterButtonWrapper />
    </div>
  );
}