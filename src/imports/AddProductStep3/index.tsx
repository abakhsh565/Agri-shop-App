import svgPaths from "./svg-v1xonlf6ag";

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

function IconArrowLeft() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="icon-arrow-left">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="icon-arrow-left">
          <path d={svgPaths.pe197860} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <IconArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Step 2</p>
    </div>
  );
}

function RightAction() {
  return (
    <div className="content-stretch flex items-start relative shrink-0" data-name="right-action">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">Step 3 of 3</p>
    </div>
  );
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">{`Expiry & Save`}</p>
      <RightAction />
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

function InputWrapper() {
  return (
    <div className="content-stretch flex h-[48px] items-center px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="input-wrapper">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Dec 15, 2028</p>
    </div>
  );
}

function InputFieldContainer() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="input-field-container">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[11px] text-black uppercase whitespace-nowrap">Expiry Date</p>
      <InputWrapper />
    </div>
  );
}

function Frame() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">{`Product & Company`}</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-black">Janja Spray</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[13px] text-black">FMC Corporation • Sprays</p>
    </div>
  );
}

function Frame2() {
  return (
    <div className="content-stretch flex items-start justify-between relative shrink-0 text-[13px] text-black w-full" data-name="Frame">
      <p className="font-['Geist:Medium',sans-serif] font-medium relative shrink-0">1 Liter (Qty: 20)</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 2,500</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="content-stretch flex items-start justify-between relative shrink-0 text-[13px] text-black w-full" data-name="Frame">
      <p className="font-['Geist:Medium',sans-serif] font-medium relative shrink-0">500ml (Qty: 35)</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 1,400</p>
    </div>
  );
}

function Frame4() {
  return (
    <div className="content-stretch flex items-start justify-between relative shrink-0 text-[13px] text-black w-full" data-name="Frame">
      <p className="font-['Geist:Medium',sans-serif] font-medium relative shrink-0">200ml (Qty: 10)</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 650</p>
    </div>
  );
}

function Frame1() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Configured Variants</p>
      <Frame2 />
      <Frame3 />
      <Frame4 />
    </div>
  );
}

function Frame5() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Expiration</p>
      <p className="font-['Geist:Medium',sans-serif] font-medium relative shrink-0 text-[13px] text-black">Dec 15, 2028</p>
    </div>
  );
}

function SummaryDetailsCard() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col gap-[16px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="summary-details-card">
      <Frame />
      <Frame1 />
      <Frame5 />
    </div>
  );
}

function SummarySection() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[12px] items-start leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="summary-section">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[13px] text-black uppercase">Product Summary Review</p>
      <SummaryDetailsCard />
    </div>
  );
}

function FormBody() {
  return (
    <div className="content-stretch flex flex-col gap-[24px] items-start p-[24px] relative shrink-0 w-full" data-name="form-body">
      <InputFieldContainer />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 354 1" width="354">
            <line id="Line" stroke="#E5E5E5" x2="354" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <SummarySection />
    </div>
  );
}

function BodyContent() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body-content">
      <StatusBar />
      <ScreenHeader />
      <FormBody />
    </div>
  );
}

function BtnSaveProduct() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-save-product">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">{`Save & Publish Product`}</p>
    </div>
  );
}

function Footer() {
  return (
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="footer">
      <BtnSaveProduct />
    </div>
  );
}

export default function AddProductStep() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="add-product-step3">
      <BodyContent />
      <Footer />
    </div>
  );
}