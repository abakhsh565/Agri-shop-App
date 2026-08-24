import svgPaths from "./svg-ssm0llw4oz";

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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Void Sale</p>
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

function AlertOctagon() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="alert-octagon">
      <svg className="absolute block inset-0 size-full" fill="none" height="24" preserveAspectRatio="none" viewBox="0 0 24 24" width="24">
        <g id="alert-octagon">
          <path d={svgPaths.p27a6200} id="Vector" stroke="#FF3B30" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function WarningBlock() {
  return (
    <div className="bg-[#fff5f5] content-stretch flex flex-col gap-[8px] items-center p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="warning-block">
      <div aria-hidden className="absolute border border-[#ff3b30] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <AlertOctagon />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#ff3b30] text-[14px] whitespace-nowrap">Deliberate Confirmation Flow</p>
    </div>
  );
}

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-start justify-between leading-[normal] relative shrink-0 text-[14px] text-black w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0">Sale #1042</p>
      <p className="relative shrink-0">Rs. 9,200</p>
    </div>
  );
}

function Frame2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col font-['Geist:Regular',sans-serif] font-normal gap-[4px] items-start relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <p className="leading-[0] relative shrink-0 text-[13px] text-black">
        <span className="leading-[normal]">{`Customer: `}</span>
        <span className="font-['Geist:Bold',sans-serif] font-bold leading-[normal]">Rashid Ali</span>
      </p>
      <p className="leading-[normal] relative shrink-0 text-[#888] text-[12px]">Aug 8, 2026 — 2:34 PM • Sold by Ahmed</p>
    </div>
  );
}

function SaleSummary() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col gap-[10px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="sale-summary">
      <Frame1 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 338 1" width="338">
            <line id="Line" stroke="#E5E5E5" x2="338" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <Frame2 />
    </div>
  );
}

function Frame4() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[13px] text-black w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0">Janja Spray 500ml x 3</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 4,200</p>
    </div>
  );
}

function Frame5() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[13px] text-black w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0">Wheat Seeds 5kg x 1</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 5,000</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[8px] items-start p-[12px] relative rounded-[12px] shrink-0 w-full" data-name="Frame">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame4 />
      <Frame5 />
    </div>
  );
}

function ItemsList() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="items-list">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Items being voided</p>
      <Frame3 />
    </div>
  );
}

function Check() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="check">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g id="check">
          <path d={svgPaths.p27200700} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function Frame7() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Frame">
      <Check />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Inventory will be restored (+3 sprays, +1 seeds)</p>
    </div>
  );
}

function Check1() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="check">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g id="check">
          <path d={svgPaths.p27200700} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function Frame8() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Frame">
      <Check1 />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Customer ledger balance will be adjusted</p>
    </div>
  );
}

function Check2() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="check">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g id="check">
          <path d={svgPaths.p27200700} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function Frame9() {
  return (
    <div className="content-stretch flex gap-[8px] items-center relative shrink-0 w-full" data-name="Frame">
      <Check2 />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Sale will be marked as Voided globally</p>
    </div>
  );
}

function Frame6() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="Frame">
      <Frame7 />
      <Frame8 />
      <Frame9 />
    </div>
  );
}

function ImpactSection() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="impact-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">What will happen</p>
      <Frame6 />
    </div>
  );
}

function Frame11() {
  return (
    <div className="content-stretch flex items-start px-[12px] py-[6px] relative rounded-[16px] shrink-0" data-name="Frame">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[16px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Wrong Product</p>
    </div>
  );
}

function Frame12() {
  return (
    <div className="content-stretch flex items-start px-[12px] py-[6px] relative rounded-[16px] shrink-0" data-name="Frame">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Wrong Quantity</p>
    </div>
  );
}

function Frame13() {
  return (
    <div className="content-stretch flex items-start px-[12px] py-[6px] relative rounded-[16px] shrink-0" data-name="Frame">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Wrong Customer</p>
    </div>
  );
}

function Frame14() {
  return (
    <div className="content-stretch flex items-start px-[12px] py-[6px] relative rounded-[16px] shrink-0" data-name="Frame">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Duplicate Entry</p>
    </div>
  );
}

function Frame10() {
  return (
    <div className="content-start flex flex-wrap gap-[8px] items-start relative shrink-0 w-full" data-name="Frame">
      <Frame11 />
      <Frame12 />
      <Frame13 />
      <Frame14 />
    </div>
  );
}

function ReasonSection() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="reason-section">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Reason for voiding</p>
      <Frame10 />
    </div>
  );
}

function InputField() {
  return (
    <div className="content-stretch flex h-[44px] items-center px-[16px] relative rounded-[8px] shrink-0 w-full" data-name="input-field">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[14px] whitespace-nowrap">e.g. Accidental billing during shift handover</p>
    </div>
  );
}

function InputGroup() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] items-start relative shrink-0 w-full" data-name="input-group">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Additional Notes (Optional)</p>
      <InputField />
    </div>
  );
}

function Content() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="content">
      <WarningBlock />
      <SaleSummary />
      <ItemsList />
      <ImpactSection />
      <ReasonSection />
      <InputGroup />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#ff3b30] text-[11px] text-center w-full">This action cannot be undone. A void record will be created.</p>
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
    <div className="bg-[#ff3b30] content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Confirm Void Sale</p>
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

export default function VoidSale() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="void-sale">
      <Body />
      <Footer />
    </div>
  );
}