import svgPaths from "./svg-j2x3rrjsty";

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
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Profile</p>
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Record Payment</p>
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

function OutstandingHero() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center p-[20px] relative rounded-[12px] shrink-0 w-full" data-name="outstanding-hero">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] uppercase whitespace-nowrap">Rashid Ali Outstanding</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[32px] text-black whitespace-nowrap">Rs. 13,200</p>
    </div>
  );
}

function Field() {
  return (
    <div className="content-stretch flex h-[48px] items-center px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="field">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">10,000</p>
    </div>
  );
}

function InputField() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="input-field">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase whitespace-nowrap">Amount to Pay (Rs.)</p>
      <Field />
    </div>
  );
}

function PillCash() {
  return (
    <div className="bg-black content-stretch flex flex-[1_0_0] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-cash">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-white whitespace-nowrap">Cash</p>
    </div>
  );
}

function PillBank() {
  return (
    <div className="content-stretch flex flex-[1_0_2px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-bank">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Bank Transfer</p>
    </div>
  );
}

function MethodPills() {
  return (
    <div className="content-stretch flex gap-[8px] items-start relative shrink-0 w-full" data-name="method-pills">
      <PillCash />
      <PillBank />
    </div>
  );
}

function MethodSelection() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="method-selection">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase whitespace-nowrap">Payment Method</p>
      <MethodPills />
    </div>
  );
}

function Field1() {
  return (
    <div className="content-stretch flex h-[72px] items-start px-[16px] py-[12px] relative rounded-[12px] shrink-0 w-full" data-name="field">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[14px] whitespace-nowrap">e.g. Partial clearance for wheat bag purchase</p>
    </div>
  );
}

function NoteField() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="note-field">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase whitespace-nowrap">Notes (Optional)</p>
      <Field1 />
    </div>
  );
}

function RecalcSummary() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] pt-[8px] relative shrink-0 w-full whitespace-nowrap" data-name="recalc-summary">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[14px]">New Balance after payment</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-black">Rs. 3,200</p>
    </div>
  );
}

function RecordContent() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="record-content">
      <OutstandingHero />
      <InputField />
      <MethodSelection />
      <NoteField />
      <RecalcSummary />
    </div>
  );
}

function RecordBody() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="record-body">
      <StatusBar />
      <ScreenHeader />
      <RecordContent />
    </div>
  );
}

function BtnPrimary() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-primary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Confirm Payment</p>
    </div>
  );
}

function RecordFooter() {
  return (
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="record-footer">
      <BtnPrimary />
    </div>
  );
}

export default function RecordCustomerPayment() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="record-customer-payment">
      <RecordBody />
      <RecordFooter />
    </div>
  );
}