import svgPaths from "./svg-4xz7227h6t";

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
    <div className="content-stretch flex flex-col items-center relative shrink-0" data-name="header-titles">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Export Data</p>
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

function Check() {
  return (
    <div className="relative shrink-0 size-[12px]" data-name="check">
      <svg className="absolute block inset-0 size-full" fill="none" height="12" preserveAspectRatio="none" viewBox="0 0 12 12" width="12">
        <g id="check">
          <path d={svgPaths.p2a580400} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function Checkbox() {
  return (
    <div className="bg-black content-stretch flex items-center justify-center relative rounded-[4px] shrink-0 size-[20px]" data-name="checkbox">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[4px]" />
      <Check />
    </div>
  );
}

function Frame1() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-center justify-between p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Sales Records</p>
      <Checkbox />
    </div>
  );
}

function Check1() {
  return (
    <div className="relative shrink-0 size-[12px]" data-name="check">
      <svg className="absolute block inset-0 size-full" fill="none" height="12" preserveAspectRatio="none" viewBox="0 0 12 12" width="12">
        <g id="check">
          <path d={svgPaths.p2a580400} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function Checkbox1() {
  return (
    <div className="bg-black content-stretch flex items-center justify-center relative rounded-[4px] shrink-0 size-[20px]" data-name="checkbox">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[4px]" />
      <Check1 />
    </div>
  );
}

function Frame2() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-center justify-between p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Customer Ledger</p>
      <Checkbox1 />
    </div>
  );
}

function Checkbox2() {
  return (
    <div className="bg-white relative rounded-[4px] shrink-0 size-[20px]" data-name="checkbox">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[4px]" />
    </div>
  );
}

function Frame3() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-center justify-between p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Inventory Report</p>
      <Checkbox2 />
    </div>
  );
}

function Checkbox3() {
  return (
    <div className="bg-white relative rounded-[4px] shrink-0 size-[20px]" data-name="checkbox">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[4px]" />
    </div>
  );
}

function Frame4() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-center justify-between p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Purchase History</p>
      <Checkbox3 />
    </div>
  );
}

function Check2() {
  return (
    <div className="relative shrink-0 size-[12px]" data-name="check">
      <svg className="absolute block inset-0 size-full" fill="none" height="12" preserveAspectRatio="none" viewBox="0 0 12 12" width="12">
        <g id="check">
          <path d={svgPaths.p2a580400} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function Checkbox4() {
  return (
    <div className="bg-black content-stretch flex items-center justify-center relative rounded-[4px] shrink-0 size-[20px]" data-name="checkbox">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[4px]" />
      <Check2 />
    </div>
  );
}

function Frame5() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-center justify-between p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Payment Records</p>
      <Checkbox4 />
    </div>
  );
}

function Checkbox5() {
  return (
    <div className="bg-white relative rounded-[4px] shrink-0 size-[20px]" data-name="checkbox">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[4px]" />
    </div>
  );
}

function Frame6() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex items-center justify-between p-[12px] relative rounded-[8px] shrink-0 w-full" data-name="Frame">
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Profit Report</p>
      <Checkbox5 />
    </div>
  );
}

function SelectionSection() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="selection-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Select Data to Export</p>
      <Frame1 />
      <Frame2 />
      <Frame3 />
      <Frame4 />
      <Frame5 />
      <Frame6 />
    </div>
  );
}

function Frame8() {
  return (
    <div className="content-stretch flex items-start p-[10px] relative rounded-[8px] shrink-0 w-full" data-name="Frame">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Aug 1, 2026</p>
    </div>
  );
}

function DateFrom() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="date-from">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] whitespace-nowrap">From</p>
      <Frame8 />
    </div>
  );
}

function Frame9() {
  return (
    <div className="content-stretch flex items-start p-[10px] relative rounded-[8px] shrink-0 w-full" data-name="Frame">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Aug 8, 2026</p>
    </div>
  );
}

function DateTo() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px relative" data-name="date-to">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] whitespace-nowrap">To</p>
      <Frame9 />
    </div>
  );
}

function Frame7() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="Frame">
      <DateFrom />
      <DateTo />
    </div>
  );
}

function DatePickerSection() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="date-picker-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Date Range</p>
      <Frame7 />
    </div>
  );
}

function PillExcel() {
  return (
    <div className="content-stretch flex flex-[1_0_36px] items-start justify-center min-w-px px-[16px] py-[10px] relative rounded-[8px]" data-name="pill-excel">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Excel (.xlsx)</p>
    </div>
  );
}

function PillCsv() {
  return (
    <div className="content-stretch flex flex-[1_0_34px] items-start justify-center min-w-px px-[16px] py-[10px] relative rounded-[8px]" data-name="pill-csv">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">CSV</p>
    </div>
  );
}

function Frame10() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="Frame">
      <PillExcel />
      <PillCsv />
    </div>
  );
}

function FormatSection() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="format-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Format</p>
      <Frame10 />
    </div>
  );
}

function Content() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="content">
      <SelectionSection />
      <DatePickerSection />
      <FormatSection />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] text-center w-full">File will be saved to your device and can be shared.</p>
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] text-center w-full">Last exported: Aug 5, 2026</p>
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

function Download() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="download">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="download">
          <path d={svgPaths.pdd92f40} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function Btn() {
  return (
    <div className="bg-black content-stretch flex gap-[8px] h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn">
      <Download />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Export</p>
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

export default function DataExport() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="data-export">
      <Body />
      <Footer />
    </div>
  );
}