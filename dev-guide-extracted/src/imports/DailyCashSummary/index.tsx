import svgPaths from "./svg-n53iqdm1n5";

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
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-black">Daily Cash Summary</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">Aug 8, 2026</p>
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

function Pen() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="pen">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_5)" id="pen">
          <path d={svgPaths.p284fba00} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_5">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Frame1() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 15,000</p>
      <Pen />
    </div>
  );
}

function MetricCard() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[8px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Opening Balance (Editable)</p>
      <Frame1 />
    </div>
  );
}

function FinRow() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Medium',sans-serif] font-medium items-start justify-between leading-[normal] py-[8px] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="fin-row">
      <p className="relative shrink-0 text-[#888]">Cash Sales</p>
      <p className="relative shrink-0 text-black">Rs. 32,400</p>
    </div>
  );
}

function FinRow1() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Medium',sans-serif] font-medium items-start justify-between leading-[normal] py-[8px] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="fin-row">
      <p className="relative shrink-0 text-[#888]">Customer Payments Received</p>
      <p className="relative shrink-0 text-black">Rs. 18,000</p>
    </div>
  );
}

function FinRow2() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-start justify-between leading-[normal] py-[8px] relative shrink-0 text-[14px] text-black w-full whitespace-nowrap" data-name="fin-row">
      <p className="relative shrink-0">Total Cash In</p>
      <p className="relative shrink-0">Rs. 50,400</p>
    </div>
  );
}

function CashInBox() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-start p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="cash-in-box">
      <FinRow />
      <FinRow1 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 346 1" width="346">
            <line id="Line" stroke="#E5E5E5" x2="346" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <FinRow2 />
    </div>
  );
}

function SectionCashIn() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="section-cash-in">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Cash In</p>
      <CashInBox />
    </div>
  );
}

function FinRow3() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Medium',sans-serif] font-medium items-start justify-between leading-[normal] py-[8px] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="fin-row">
      <p className="relative shrink-0 text-[#888]">Supplier Payments (Cash)</p>
      <p className="relative shrink-0 text-black">Rs. 25,000</p>
    </div>
  );
}

function FinRow4() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-start justify-between leading-[normal] py-[8px] relative shrink-0 text-[14px] text-black w-full whitespace-nowrap" data-name="fin-row">
      <p className="relative shrink-0">Total Cash Out</p>
      <p className="relative shrink-0">Rs. 25,000</p>
    </div>
  );
}

function CashOutBox() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-start p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="cash-out-box">
      <FinRow3 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 346 1" width="346">
            <line id="Line" stroke="#E5E5E5" x2="346" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <FinRow4 />
    </div>
  );
}

function SectionCashOut() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="section-cash-out">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Cash Out</p>
      <CashOutBox />
    </div>
  );
}

function ExpectedHero() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center p-[20px] relative rounded-[12px] shrink-0 w-full" data-name="expected-hero">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Expected Cash in Hand</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[28px] text-black whitespace-nowrap">Rs. 40,400</p>
    </div>
  );
}

function InputField() {
  return (
    <div className="content-stretch flex h-[44px] items-center px-[16px] relative rounded-[8px] shrink-0 w-full" data-name="input-field">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">40,400</p>
    </div>
  );
}

function InputGroup() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-start relative shrink-0 w-full" data-name="input-group">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Actual Cash in Hand</p>
      <InputField />
    </div>
  );
}

function DiffTag() {
  return (
    <div className="bg-[#ebfeeb] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[12px] shrink-0" data-name="diff-tag">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#1e7e34] text-[11px] whitespace-nowrap">Rs. 0 (Balanced)</p>
    </div>
  );
}

function DiffRow() {
  return (
    <div className="content-stretch flex items-center justify-between px-[4px] relative shrink-0 w-full" data-name="diff-row">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Difference</p>
      <DiffTag />
    </div>
  );
}

function Content() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="content">
      <MetricCard />
      <SectionCashIn />
      <SectionCashOut />
      <ExpectedHero />
      <InputGroup />
      <DiffRow />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] text-center w-full">{`Note: Closing balance becomes tomorrow's opening balance.`}</p>
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <Content />
    </div>
  );
}

function Btn() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Close Day</p>
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

export default function DailyCashSummary() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="daily-cash-summary">
      <Body />
      <Footer />
    </div>
  );
}