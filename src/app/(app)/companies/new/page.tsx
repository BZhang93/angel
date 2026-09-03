import { Card } from "@/components/ui";
import { ActionForm, Checkbox, Field, Select } from "@/components/forms";
import {
  HOLDING_ENTITY_OPTIONS,
  INSTRUMENT_OPTIONS,
  STAGE_OPTIONS,
  STATUS_OPTIONS,
} from "@/lib/enums";
import { createCompany } from "../actions";

export default function NewCompanyPage() {
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Add Company</h1>
      <Card>
        <ActionForm action={createCompany} submitLabel="Save Company">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" name="name" required placeholder="Acme Robotics" />
            <Field label="Website" name="website" placeholder="https://acme.com" />
            <Field label="Sector" name="sector" placeholder="Robotics" />
            <Field label="HQ country" name="hqCountry" placeholder="United States" />
            <Select label="Stage at investment" name="stage" options={STAGE_OPTIONS} defaultValue="SEED" />
            <Select label="Status" name="status" options={STATUS_OPTIONS} defaultValue="ACTIVE" />
            <Field label="Sourced by" name="sourcedBy" placeholder="Who introduced the deal" />
            <Field label="Notes" name="notes" />
          </div>

          <div className="border-t border-border pt-3">
            <h2 className="text-sm font-semibold">First Position</h2>
            <p className="mb-3 text-xs text-muted">
              Optional, but a company with no position is a note to self rather than an
              investment. Everything here can be edited later.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Instrument" name="instrumentType" options={INSTRUMENT_OPTIONS} />
              <Select label="Holding entity" name="holdingEntity" options={HOLDING_ENTITY_OPTIONS} />
              <Field label="Amount invested" name="amount" type="number" placeholder="25000" />
              <Field
                label="Investment date"
                name="investmentDate"
                type="date"
                hint="Starts the QSBS and IRR clocks."
              />
              <Field label="Valuation cap" name="valuationCap" type="number" placeholder="8000000" />
              <Field label="Discount %" name="discountPct" type="number" placeholder="20" />
              <Field label="Maturity date" name="maturityDate" type="date" hint="Convertible notes only." />
              <div className="space-y-2 pt-5">
                <Checkbox label="Post-money SAFE" name="safeIsPostMoney" />
                <Checkbox label="Pro rata side letter" name="hasProRata" />
                <Checkbox
                  label="QSBS eligible"
                  name="qsbsEligible"
                  hint="Tracks the five-year §1202 holding date."
                />
              </div>
            </div>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
