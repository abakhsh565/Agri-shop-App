import svgPaths from "./svg-2gkc0cmd9h";

function Signal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_10)" id="signal">
          <path clipRule="evenodd" d={svgPaths.p159df970} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_10">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Wifi() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="wifi">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_8)" id="wifi">
          <path clipRule="evenodd" d={svgPaths.p18941500} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_8">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Battery() {
  return (
    <div className="h-[20px] relative shrink-0 w-[28px]" data-name="battery">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 28 20" width="28">
        <g clipPath="url(#clip0_0_6)" id="battery">
          <path d={svgPaths.p7132ff1} fill="black" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_6">
            <rect fill="white" height="20" width="28" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="status-icons">
      <Signal />
      <Wifi />
      <Battery />
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
    <div className="relative shrink-0 size-[16px]" data-name="arrowLeft">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_4)" id="arrowLeft">
          <g id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_4">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <ArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Step 2</p>
    </div>
  );
}

function Frame() {
  return <div className="h-px relative shrink-0 w-[60px]" data-name="Frame" />;
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">New Purchase</p>
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

function StepIndicator() {
  return (
    <div className="[word-break:break-word] bg-[#f5f5f5] content-stretch flex items-center justify-between leading-[normal] p-[16px] relative shrink-0 text-[13px] w-full whitespace-nowrap" data-name="step-indicator">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Step 3 of 3: Final Payment</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">99% Completed</p>
    </div>
  );
}

function ReviewBillboard() {
  return (
    <div className="content-stretch flex flex-col gap-[10px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="review-billboard">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Total Purchase Cost</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[28px] text-black whitespace-nowrap">Rs. 1,44,000</p>
      <div className="bg-[#e5e5e5] h-px relative shrink-0 w-full" data-name="line" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">FMC Corp • Cartap 4G • 120 Bags</p>
    </div>
  );
}

function InputWrapper() {
  return (
    <div className="content-stretch flex h-[48px] items-center px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="input-wrapper">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 1,00,000</p>
    </div>
  );
}

function InputField() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="input-field">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Amount Paid Right Now</p>
      <InputWrapper />
    </div>
  );
}

function Row() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-black w-full whitespace-nowrap" data-name="row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[13px]">Remaining Balance (Credit)</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px]">Rs. 44,000</p>
    </div>
  );
}

function AutoOutstanding() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col items-start p-[16px] relative rounded-[8px] shrink-0 w-full" data-name="auto-outstanding">
      <Row />
    </div>
  );
}

function PillActive() {
  return (
    <div className="content-stretch flex flex-[1_0_4px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-active">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Bank Transfer</p>
    </div>
  );
}

function PillInactive() {
  return (
    <div className="content-stretch flex flex-[1_0_2px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-inactive">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">Cash</p>
    </div>
  );
}

function PillsRow() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="pills-row">
      <PillActive />
      <PillInactive />
    </div>
  );
}

function PaymentMethod() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="payment-method">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Payment Method</p>
      <PillsRow />
    </div>
  );
}

function SummaryForm() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="summary-form">
      <ReviewBillboard />
      <InputField />
      <AutoOutstanding />
      <PaymentMethod />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <StepIndicator />
      <SummaryForm />
    </div>
  );
}

function BtnComplete() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-complete">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">{`Complete & Stock-In`}</p>
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
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="footer">
      <BtnComplete />
      <HomeIndicator />
    </div>
  );
}

export default function NewPurchaseStep() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="new-purchase-step3">
      <Body />
      <Footer />
    </div>
  );
}