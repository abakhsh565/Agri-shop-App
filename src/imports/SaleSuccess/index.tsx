import svgPaths from "./svg-c2jqkxjwoh";

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

function Check() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="check">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="check">
          <path d={svgPaths.p24ddc900} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="3" />
        </g>
      </svg>
    </div>
  );
}

function SuccessIconWrap() {
  return (
    <div className="bg-black content-stretch flex flex-col items-center justify-center relative rounded-[40px] shrink-0 size-[80px]" data-name="success-icon-wrap">
      <Check />
    </div>
  );
}

function SuccessHeaders() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-center leading-[normal] relative shrink-0 text-center w-full whitespace-nowrap" data-name="success-headers">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[28px] text-black">Sale Completed!</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[14px]">Receipt generated successfully</p>
    </div>
  );
}

function ReceiptRow() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="receipt-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Customer</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Rashid Ali</p>
    </div>
  );
}

function ReceiptRow1() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="receipt-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Total Amount</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Rs. 9,200</p>
    </div>
  );
}

function ReceiptRow2() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="receipt-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Paid</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Rs. 7,000</p>
    </div>
  );
}

function ReceiptRow3() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="receipt-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Outstanding</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Rs. 2,200</p>
    </div>
  );
}

function ReceiptRow4() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="receipt-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Payment Method</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Cash</p>
    </div>
  );
}

function ReceiptRow5() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="receipt-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">{`Date & Time`}</p>
      <p className="font-['Geist:Medium',sans-serif] font-medium relative shrink-0 text-black text-end">Aug 8, 2026 — 2:34 PM</p>
    </div>
  );
}

function ReceiptRow6() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="receipt-row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Sold by</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Ahmed</p>
    </div>
  );
}

function ReceiptSummary() {
  return (
    <div className="content-stretch flex flex-col gap-[16px] items-start p-[20px] relative rounded-[16px] shrink-0 w-full" data-name="receipt-summary">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[16px]" />
      <ReceiptRow />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 314 1" width="314">
            <line id="Line" stroke="#E5E5E5" x2="314" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <ReceiptRow1 />
      <ReceiptRow2 />
      <ReceiptRow3 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 314 1" width="314">
            <line id="Line" stroke="#E5E5E5" x2="314" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <ReceiptRow4 />
      <ReceiptRow5 />
      <ReceiptRow6 />
    </div>
  );
}

function SuccessContent() {
  return (
    <div className="content-stretch flex flex-col gap-[32px] items-center pb-[24px] pt-[40px] px-[24px] relative shrink-0 w-full" data-name="success-content">
      <SuccessIconWrap />
      <SuccessHeaders />
      <ReceiptSummary />
    </div>
  );
}

function SuccessBody() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="success-body">
      <StatusBar />
      <SuccessContent />
    </div>
  );
}

function BtnPrimary() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-primary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">New Sale</p>
    </div>
  );
}

function BtnSecondary() {
  return (
    <div className="content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-secondary">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">View Receipt</p>
    </div>
  );
}

function SuccessActions() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-center p-[24px] relative shrink-0 w-full" data-name="success-actions">
      <BtnPrimary />
      <BtnSecondary />
    </div>
  );
}

export default function SaleSuccess() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="sale-success">
      <SuccessBody />
      <SuccessActions />
    </div>
  );
}