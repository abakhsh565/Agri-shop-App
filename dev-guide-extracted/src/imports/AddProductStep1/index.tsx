import svgPaths from "./svg-arvuyzf3ml";

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
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Products</p>
    </div>
  );
}

function RightAction() {
  return (
    <div className="content-stretch flex items-start relative shrink-0" data-name="right-action">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">Step 1 of 3</p>
    </div>
  );
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Add Product</p>
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

function ChevronDown() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="chevron-down">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_4)" id="chevron-down">
          <path d="M-5.96046e-08 6L2 14L4 6" id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
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

function SelectField() {
  return (
    <div className="content-stretch flex h-[48px] items-center justify-between px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="select-field">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">FMC Corporation</p>
      <ChevronDown />
    </div>
  );
}

function SelectSupplier() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="select-supplier">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[11px] text-black uppercase whitespace-nowrap">Select Company</p>
      <SelectField />
    </div>
  );
}

function InputWrapper() {
  return (
    <div className="content-stretch flex h-[48px] items-center px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="input-wrapper">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[14px] whitespace-nowrap">e.g. Janja Spray</p>
    </div>
  );
}

function InputFieldContainer() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="input-field-container">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[11px] text-black uppercase whitespace-nowrap">Product Name</p>
      <InputWrapper />
    </div>
  );
}

function PillActive() {
  return (
    <div className="content-stretch flex flex-[1_0_4px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-active">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Spray</p>
    </div>
  );
}

function PillInactive() {
  return (
    <div className="content-stretch flex flex-[1_0_2px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-inactive">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[13px] whitespace-nowrap">Seed</p>
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

function SelectCategory() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="select-category">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[11px] text-black uppercase whitespace-nowrap">Category</p>
      <PillsRow />
    </div>
  );
}

function FormBody() {
  return (
    <div className="content-stretch flex flex-col gap-[24px] items-start p-[24px] relative shrink-0 w-full" data-name="form-body">
      <SelectSupplier />
      <InputFieldContainer />
      <SelectCategory />
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

function BtnNext() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-next">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Next Step</p>
    </div>
  );
}

function Footer() {
  return (
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="footer">
      <BtnNext />
    </div>
  );
}

export default function AddProductStep() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="add-product-step1">
      <BodyContent />
      <Footer />
    </div>
  );
}