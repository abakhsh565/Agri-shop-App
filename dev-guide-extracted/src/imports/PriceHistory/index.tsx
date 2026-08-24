import svgPaths from "./svg-75xjstvivv";

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

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <ArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Back</p>
    </div>
  );
}

function HeaderTitles() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col items-center leading-[normal] relative shrink-0 text-center whitespace-nowrap" data-name="header-titles">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-black">Price History</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">Audit Trail</p>
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
      <HeaderTitles />
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
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-black">Janja Spray — 500ml</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">SKU: AGR-JNJ-500</p>
    </div>
  );
}

function Frame2() {
  return (
    <div className="content-stretch flex flex-col font-['Geist:Bold',sans-serif] font-bold items-end relative shrink-0" data-name="Frame">
      <p className="relative shrink-0 text-[#888] text-[11px] uppercase">Current Price</p>
      <p className="relative shrink-0 text-[18px] text-black">Rs. 2,500</p>
    </div>
  );
}

function ProductHighlight() {
  return (
    <div className="[word-break:break-word] bg-[#f5f5f5] content-stretch flex items-center justify-between leading-[normal] p-[16px] relative shrink-0 w-full whitespace-nowrap" data-name="product-highlight">
      <Frame1 />
      <Frame2 />
    </div>
  );
}

function Frame4() {
  return (
    <div className="bg-black content-stretch flex items-start px-[8px] py-[2px] relative rounded-[12px] shrink-0" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-white whitespace-nowrap">ACTIVE</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 2,300 to Rs. 2,500</p>
      <Frame4 />
    </div>
  );
}

function Frame5() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col font-['Geist:Regular',sans-serif] font-normal gap-[2px] items-start leading-[normal] relative shrink-0 w-full" data-name="Frame">
      <p className="relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Changed on Aug 1, 2026 • by Owner</p>
      <p className="min-w-full relative shrink-0 text-[13px] text-black w-[min-content]">Reason: General inflation rate adjustment on imported chemicals</p>
    </div>
  );
}

function HistoryRow() {
  return (
    <div className="bg-[#f5faf5] content-stretch flex flex-col gap-[8px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="history-row">
      <div aria-hidden className="absolute border-[1.5px] border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame3 />
      <Frame5 />
    </div>
  );
}

function Frame6() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 2,200 to Rs. 2,300</p>
    </div>
  );
}

function Frame7() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col font-['Geist:Regular',sans-serif] font-normal gap-[2px] items-start leading-[normal] relative shrink-0 w-full" data-name="Frame">
      <p className="relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Changed on Jun 15, 2026 • by Owner</p>
      <p className="min-w-full relative shrink-0 text-[13px] text-black w-[min-content]">Reason: Supplier price increase and shipping freight adjustments</p>
    </div>
  );
}

function HistoryRow1() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[8px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="history-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame6 />
      <Frame7 />
    </div>
  );
}

function Frame8() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 2,000 to Rs. 2,200</p>
    </div>
  );
}

function Frame9() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col font-['Geist:Regular',sans-serif] font-normal gap-[2px] items-start leading-[normal] relative shrink-0 w-full" data-name="Frame">
      <p className="relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Changed on Mar 1, 2026 • by Owner</p>
      <p className="min-w-full relative shrink-0 text-[13px] text-black w-[min-content]">Reason: New formulation release price increase</p>
    </div>
  );
}

function HistoryRow2() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[8px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="history-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame8 />
      <Frame9 />
    </div>
  );
}

function Frame10() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 2,000 (Initial price)</p>
    </div>
  );
}

function Frame11() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col font-['Geist:Regular',sans-serif] font-normal gap-[2px] items-start leading-[normal] relative shrink-0 w-full" data-name="Frame">
      <p className="relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Changed on Jan 10, 2026 • by System</p>
      <p className="min-w-full relative shrink-0 text-[13px] text-black w-[min-content]">Reason: Product registered in AgriShop Central Database</p>
    </div>
  );
}

function HistoryRow3() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[8px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="history-row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame10 />
      <Frame11 />
    </div>
  );
}

function Content() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="content">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Timeline of Price Changes</p>
      <HistoryRow />
      <HistoryRow1 />
      <HistoryRow2 />
      <HistoryRow3 />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <ProductHighlight />
      <Content />
    </div>
  );
}

function Btn() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Back to Catalog</p>
    </div>
  );
}

function HomeIndicator() {
  return (
    <div className="content-stretch flex items-start justify-center py-[8px] relative shrink-0 w-full" data-name="home-indicator">
      <div className="bg-black h-[5px] relative rounded-[100px] shrink-0 w-[139px]" data-name="indicator-bar" />
    </div>
  );
}

function Footer() {
  return (
    <div className="content-stretch flex flex-col items-start p-[16px] relative shrink-0 w-full" data-name="footer">
      <Btn />
      <HomeIndicator />
    </div>
  );
}

export default function PriceHistory() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="price-history">
      <Body />
      <Footer />
    </div>
  );
}