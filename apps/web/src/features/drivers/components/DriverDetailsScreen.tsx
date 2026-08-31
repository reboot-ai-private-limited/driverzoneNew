'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { User, CheckCircle, XCircle, FileText } from 'lucide-react';
import {
  Badge,
  Button,
  DataState,
  DefinitionList,
  Dialog,
  FieldRow,
  Input,
  PageHeader,
  Panel,
  StatusPill,
  Tooltip,
  cn,
  toast,
} from '@driverzone/design-system';
import type { DriverDocumentDto } from '@driverzone/contracts';
import { toErrorState } from '@/lib/api/toErrorState';
import {
  useDriverDetails,
  useApproveDriver,
  useRejectDriver,
} from '../hooks/useDriverDetails';
import { DriverWalletTab } from './DriverWalletTab';
import { DriverDutyHistoryTab } from './DriverDutyHistoryTab';

export function DriverDetailsScreen() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  const query = useDriverDetails(id);
  const approveMutation = useApproveDriver(id);
  const rejectMutation = useRejectDriver(id);

  const [activeTab, setActiveTab] = useState<'profile' | 'financials' | 'duty'>('profile');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const [reviewingDoc, setReviewingDoc] = useState<DriverDocumentDto | null>(null);

  const getExpirationStatus = (expiresOn: string | null) => {
    if (!expiresOn) return 'UNKNOWN';
    const expires = new Date(expiresOn);
    if (isNaN(expires.getTime())) return 'UNKNOWN';

    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    if (expires < now) return 'EXPIRED';
    if (expires <= thirtyDaysFromNow) return 'EXPIRING_SOON';
    return 'VALID';
  };

  if (query.isLoading) {
    return (
      <DataState loading={true} skeleton={<div className="p-8">Loading driver details...</div>}>
        <div />
      </DataState>
    );
  }

  if (query.isError || !query.data) {
    return (
      <DataState
        loading={false}
        skeleton={<></>}
        error={query.isError ? toErrorState(query.error, () => query.refetch()) : undefined}
      >
        <div />
      </DataState>
    );
  }

  const { profile, documents } = query.data;

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync();
      toast.success('Driver approved successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve driver');
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    try {
      await rejectMutation.mutateAsync({ reason: rejectReason });
      setRejectDialogOpen(false);
      setRejectReason('');
      toast.success('Driver rejected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject driver');
    }
  };


  return (
    <>
      <PageHeader
        title="Driver Details"
        onBack={() => router.push('/drivers')}
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Drivers', href: '/drivers' },
          { label: profile.full_name || profile.mobile_number },
        ]}
        actions={
          <div className="flex gap-2">
            {profile.onboarding_status === 'REJECTED' ? (
              <Tooltip content="Driver is already rejected">
                <span>
                  <Button
                    variant="secondary"
                    icon={<XCircle className="size-4" />}
                    disabled
                  >
                    Reject
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                variant="secondary"
                icon={<XCircle className="size-4" />}
                onClick={() => setRejectDialogOpen(true)}
                loading={rejectMutation.isPending}
              >
                Reject
              </Button>
            )}

            {profile.is_verified ? (
              <Tooltip content="Driver is already verified">
                <span>
                  <Button
                    variant="primary"
                    icon={<CheckCircle className="size-4" />}
                    disabled
                  >
                    Verified
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                variant="primary"
                icon={<CheckCircle className="size-4" />}
                onClick={handleApprove}
                loading={approveMutation.isPending}
              >
                Approve
              </Button>
            )}
          </div>
        }
      />

      <nav className="flex items-center gap-6 border-b border-border mb-6">
        <button
          onClick={() => setActiveTab('profile')}
          className={cn(
            "pb-3 text-sm font-medium transition-colors border-b-2",
            activeTab === 'profile'
              ? "border-interactive text-interactive"
              : "border-transparent text-text-subtle hover:text-text hover:border-border"
          )}
        >
          Profile & Documents
        </button>
        <button
          onClick={() => setActiveTab('financials')}
          className={cn(
            "pb-3 text-sm font-medium transition-colors border-b-2",
            activeTab === 'financials'
              ? "border-interactive text-interactive"
              : "border-transparent text-text-subtle hover:text-text hover:border-border"
          )}
        >
          Financials
        </button>
        <button
          onClick={() => setActiveTab('duty')}
          className={cn(
            "pb-3 text-sm font-medium transition-colors border-b-2",
            activeTab === 'duty'
              ? "border-interactive text-interactive"
              : "border-transparent text-text-subtle hover:text-text hover:border-border"
          )}
        >
          Duty History
        </button>
      </nav>

      {activeTab === 'profile' && (
        <div className="flex flex-col gap-6 w-full">
          <Panel title="Personal Details">
            <div className="flex flex-col md:flex-row gap-8">
              <div className="flex flex-col items-center shrink-0 w-full md:w-48">
                {profile.profile_picture ? (
                  <img
                    src={profile.profile_picture}
                    alt={`${profile.full_name}'s profile`}
                    className="w-20 h-20 rounded-full object-cover border border-border mb-3"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center text-accent-ink mb-3">
                    <User className="w-8 h-8" />
                  </div>
                )}
                <h3 className="text-base font-semibold text-center leading-tight">
                  {profile.full_name || 'Unnamed Driver'}
                </h3>
                <div className="text-[10px] text-text-subtle tnum mt-0.5">
                  ID: {profile.id}
                </div>

                <div className="mt-3 flex flex-col items-center gap-1.5">
                  <StatusPill status={profile.onboarding_status} />
                  {profile.onboarding_status === 'REJECTED' && profile.onboarding_rejection_reason && (
                    <div className="text-[10px] text-danger text-center max-w-[160px] leading-tight">
                      <span className="font-semibold">Reason:</span> {profile.onboarding_rejection_reason}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-12 content-start">
                <DefinitionList>
                  <FieldRow label="Phone Number">
                    <span className="tnum">{profile.mobile_number}</span>
                  </FieldRow>
                  <FieldRow label="Alternate Phone">
                    <span className="tnum">{profile.alternate_number || '—'}</span>
                  </FieldRow>
                  <FieldRow label="Gender">
                    {profile.gender || '—'}
                  </FieldRow>
                  <FieldRow label="Date of Birth">
                    <span className="tnum">{profile.dob || '—'}</span>
                  </FieldRow>
                </DefinitionList>

                <DefinitionList>
                  <FieldRow label="Experience">
                    {profile.experience_years ? <span className="tnum">{profile.experience_years} years</span> : '—'}
                  </FieldRow>
                  <FieldRow label="Emergency Contact">
                    {profile.emergency_contact ? (
                      <div className="flex items-center justify-end gap-1">
                        {profile.emergency_contact.name && <span>{profile.emergency_contact.name}</span>}
                        {profile.emergency_contact.number && <span className="text-text-subtle tnum">({profile.emergency_contact.number})</span>}
                      </div>
                    ) : '—'}
                  </FieldRow>
                  <FieldRow label="Address">
                    <span className="text-right max-w-[200px] truncate block" title={profile.address || ''}>
                      {profile.address || '—'}
                    </span>
                  </FieldRow>
                </DefinitionList>
              </div>
            </div>
          </Panel>

          <Panel title="Driving Preferences">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
              <DefinitionList>
                <FieldRow label="Vehicle Categories">
                  {profile.vehicle_category_preference.length > 0
                    ? profile.vehicle_category_preference.join(', ')
                    : 'Any'}
                </FieldRow>
                <FieldRow label="Transmission">
                  {profile.vehicle_type_preference || 'Any'}
                </FieldRow>
              </DefinitionList>

              <DefinitionList>
                <FieldRow label="Hill Driving (Declared)">
                  {profile.can_drive_hill ? 'Yes' : 'No'}
                </FieldRow>
                <FieldRow label="Hill Driving (Verified)">
                  <Badge tone={profile.can_drive_hill_verified ? 'success' : 'neutral'}>
                    {profile.can_drive_hill_verified ? 'Verified' : 'Not Verified'}
                  </Badge>
                </FieldRow>
              </DefinitionList>
            </div>
          </Panel>

          <Panel title="Documents">
            {documents.length === 0 ? (
              <DataState
                loading={false}
                skeleton={<></>}
                empty={true}
                emptyState={{
                  icon: <User aria-hidden className="size-6" />,
                  title: 'No documents',
                  description: 'This driver has not uploaded any documents yet.',
                }}
              >
                <div />
              </DataState>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {documents.map((doc) => {
                  const expStatus = getExpirationStatus(doc.expires_on);
                  return (
                  <div key={doc.id} className="flex gap-4 p-3 rounded-md border border-border bg-surface items-center">
                    <button
                      onClick={() => setReviewingDoc(doc)}
                      className="relative flex-shrink-0 flex items-center justify-center w-16 h-16 overflow-hidden rounded bg-accent text-accent-ink hover:bg-accent-hover transition-colors"
                      aria-label="Preview document"
                    >
                      {doc.url ? (
                        doc.url.toLowerCase().endsWith('.pdf') ? (
                          <FileText className="size-6" />
                        ) : (
                          <>
                            <FileText className="size-6 absolute" />
                            <img
                              src={doc.url}
                              alt=""
                              className="object-cover w-full h-full relative z-10 text-transparent"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          </>
                        )
                      ) : (
                        <span className="text-[10px] font-medium">No file</span>
                      )}
                    </button>

                    <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-baseline gap-2 truncate">
                          <span className="font-semibold text-text text-sm leading-tight">{doc.doc_type}</span>
                          {doc.sub_type && <span className="text-[10px] text-text-subtle">{doc.sub_type}</span>}
                        </div>
                        <StatusPill status={doc.status} />
                      </div>

                      {doc.number && <div className="text-sm font-medium text-text tnum truncate">{doc.number}</div>}

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-subtle">
                        <div>
                          Issued: <span className="font-medium text-text tnum">{doc.issued_on || '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          Expires:
                          <span className={cn(
                            "font-medium tnum",
                            expStatus === 'EXPIRED' && "text-danger",
                            expStatus === 'EXPIRING_SOON' && "text-warning",
                            expStatus === 'VALID' && "text-text"
                          )}>
                            {doc.expires_on || '—'}
                          </span>
                          {expStatus === 'EXPIRED' && (
                            <Badge tone="danger">Expired</Badge>
                          )}
                          {expStatus === 'EXPIRING_SOON' && (
                            <Badge tone="warning">Soon</Badge>
                          )}
                        </div>
                      </div>

                      {doc.rejection_reason && (
                        <div className="text-[10px] text-danger mt-0.5 max-w-full truncate">
                          <span className="font-semibold">Reason:</span> {doc.rejection_reason}
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {activeTab === 'financials' && <DriverWalletTab driverId={id} />}
      {activeTab === 'duty' && <DriverDutyHistoryTab driverId={id} />}

      {/* Reject Driver Dialog */}
      <Dialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        title="Reject Driver Profile"
        description="Provide a reason for rejection. This will be shown to the driver."
      >
        <div className="space-y-4 py-4">
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Documents are blurry or incomplete"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!rejectReason.trim()}
              loading={rejectMutation.isPending}
              onClick={handleReject}
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Dialog>

      {/* View Document Dialog */}
      <Dialog
        open={!!reviewingDoc}
        onOpenChange={(open) => !open && setReviewingDoc(null)}
        title={`View ${reviewingDoc?.doc_type}`}
        description="Preview of the uploaded document."
        className="max-w-3xl"
      >
        <div className="space-y-4 py-4">
          <div className="w-full bg-surface-sunken border border-border rounded flex items-center justify-center overflow-hidden min-h-[300px] h-[50vh] max-h-[600px]">
            {reviewingDoc?.url ? (
              reviewingDoc.url.toLowerCase().endsWith('.pdf') ? (
                <iframe src={reviewingDoc.url} className="w-full h-full border-0" title="Document Preview" />
              ) : (
                <img src={reviewingDoc.url} alt="Document Preview" className="max-w-full max-h-full object-contain" />
              )
            ) : (
              <span className="text-text-subtle">No file uploaded</span>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
