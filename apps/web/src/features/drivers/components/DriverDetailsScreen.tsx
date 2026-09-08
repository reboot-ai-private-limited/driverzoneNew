'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { User, CheckCircle, XCircle, FileText, CircleSlash, Pencil, ArrowLeft } from 'lucide-react';
import {
  Badge,
  Button,
  DataState,
  DefinitionList,
  Dialog,
  FieldRow,
  FormField,
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
  useVerifyHillDriving,
  useReviewDocument,
  useSuspendDriver,
} from '../hooks/useDriverDetails';
import { DriverWalletTab } from './DriverWalletTab';
import { DriverDutyHistoryTab } from './DriverDutyHistoryTab';
import { DriverEditDialog } from './DriverEditDialog';

export function DriverDetailsScreen() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  const query = useDriverDetails(id);
  const approveMutation = useApproveDriver(id);
  const rejectMutation = useRejectDriver(id);
  const verifyHillDrivingMutation = useVerifyHillDriving(id);
  const reviewDocumentMutation = useReviewDocument(id);
  const suspendMutation = useSuspendDriver(id);

  const [activeTab, setActiveTab] = useState<'profile' | 'financials' | 'duty'>('profile');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const [reviewingDoc, setReviewingDoc] = useState<DriverDocumentDto | null>(null);
  const [docRejectReason, setDocRejectReason] = useState('');

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
  const dlDoc = documents.find((d) => d.doc_type === 'LICENCE');

  const handleApprove = async () => {
    try {
      const pendingDocs = documents.filter(d => d.status === 'PENDING');
      for (const doc of pendingDocs) {
        await reviewDocumentMutation.mutateAsync({ docId: doc.id, data: { status: 'VERIFIED' } });
      }
      await approveMutation.mutateAsync();
      toast.success('Driver and pending documents approved successfully');
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

  const handleOpenRejectDialog = () => {
    const lines = [];
    let hasRejectedDoc = false;
    for (const doc of documents) {
      if (doc.status === 'VERIFIED') {
        lines.push(`- ${doc.doc_type}: Accepted`);
      } else if (doc.status === 'REJECTED') {
        hasRejectedDoc = true;
        lines.push(`- ${doc.doc_type}: Rejected (${doc.rejection_reason || 'No reason provided'})`);
      } else {
        lines.push(`- ${doc.doc_type}: Pending review`);
      }
    }

    if (documents.length === 0) {
      setRejectReason('Your profile has been rejected. Please provide required documents.');
    } else {
      const prefix = hasRejectedDoc ? "Your profile has been rejected based on the following document reviews:" : "Your profile requires further attention:";
      setRejectReason(`${prefix}\n${lines.join('\n')}`);
    }
    setRejectDialogOpen(true);
  };

  const handleVerifyHillDriving = async (verified: boolean) => {
    try {
      await verifyHillDrivingMutation.mutateAsync({ verified });
      toast.success(`Hill driving ${verified ? 'verified' : 'unverified'} successfully`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update hill driving verification');
    }
  };

  const handleReviewDocument = async (status: 'VERIFIED' | 'REJECTED') => {
    if (!reviewingDoc) return;
    if (status === 'REJECTED' && !docRejectReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }

    try {
      await reviewDocumentMutation.mutateAsync({ docId: reviewingDoc.id, data: { status, reason: status === 'REJECTED' ? docRejectReason : undefined } });
      toast.success(`Document ${status.toLowerCase()}`);
      setReviewingDoc(null);
      setDocRejectReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to review document');
    }
  };


  return (
    <>
      <PageHeader
        title="Driver Details"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Drivers', href: '/drivers' },
          { label: profile.full_name || profile.mobile_number },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              icon={<ArrowLeft aria-hidden className="size-3.5" />}
              onClick={() => router.push('/drivers')}
            >
              Back
            </Button>

            <Button
              size="sm"
              icon={<Pencil aria-hidden className="size-3.5" />}
              onClick={() => setIsEditing(true)}
            >
              Edit
            </Button>

            {profile.is_suspended ? (
              <Button
                size="sm"
                variant="primary"
                icon={<CheckCircle aria-hidden className="size-3.5" />}
                onClick={() => {
                  setSuspendReason('');
                  setConfirmingSuspend(true);
                }}
              >
                Reinstate
              </Button>
            ) : (
              <Button
                size="sm"
                variant="danger"
                icon={<CircleSlash aria-hidden className="size-3.5" />}
                onClick={() => {
                  setSuspendReason('');
                  setConfirmingSuspend(true);
                }}
              >
                Suspend
              </Button>
            )}

            {!profile.is_verified && (
              profile.onboarding_status === 'REJECTED' ? (
                <Tooltip content="Driver is already rejected">
                  <span>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<XCircle aria-hidden className="size-3.5" />}
                      disabled
                    >
                      Reject
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<XCircle aria-hidden className="size-3.5" />}
                  onClick={handleOpenRejectDialog}
                  loading={rejectMutation.isPending}
                >
                  Reject
                </Button>
              )
            )}

            {profile.is_verified ? (
              <Tooltip content="Driver is already verified">
                <span>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<CheckCircle aria-hidden className="size-3.5" />}
                    disabled
                  >
                    Verified
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={<CheckCircle className="size-3.5" />}
                onClick={handleApprove}
                loading={approveMutation.isPending}
              >
                Verify
              </Button>
            )}
          </div>
        }
      />

      {profile.is_suspended && (
        <div className="mb-6 p-4 rounded-lg bg-danger/10 border border-danger/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <CircleSlash className="size-5 text-danger shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-danger">Driver Account Suspended</h4>
              <p className="text-xs text-text mt-0.5">
                {profile.suspension_reason ? (
                  <>
                    <span className="font-medium text-text-subtle">Reason:</span> {profile.suspension_reason}
                  </>
                ) : (
                  'This driver is currently suspended and cannot go on duty or accept trip requests.'
                )}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            icon={<CheckCircle aria-hidden className="size-3.5" />}
            onClick={() => {
              setSuspendReason('');
              setConfirmingSuspend(true);
            }}
            className="self-start sm:self-center shrink-0"
          >
            Reinstate Driver
          </Button>
        </div>
      )}

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
                  {profile.is_suspended ? (
                    <Badge tone="danger">Suspended</Badge>
                  ) : (
                    <StatusPill status={profile.onboarding_status} />
                  )}
                  {profile.is_suspended && profile.suspension_reason && (
                    <div className="text-[10px] text-danger text-center max-w-[160px] leading-tight">
                      <span className="font-semibold">Reason:</span> {profile.suspension_reason}
                    </div>
                  )}
                  {!profile.is_suspended && profile.onboarding_status === 'REJECTED' && profile.onboarding_rejection_reason && (
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
                  <FieldRow label="DL Number">
                    <span className="tnum font-medium">{dlDoc?.number || '—'}</span>
                  </FieldRow>
                  <FieldRow label="DL Expiry">
                    <span className="tnum">{dlDoc?.expires_on || '—'}</span>
                  </FieldRow>
                </DefinitionList>
              </div>
            </div>
          </Panel>

          <Panel title="Driving Preferences">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
              <DefinitionList>
                {/* Empty means excluded from dispatch, never "will take anything" — see the
                    same wording in the drivers table. */}
                <FieldRow label="Vehicle Categories">
                  {profile.vehicle_category_preference.length > 0
                    ? profile.vehicle_category_preference.join(', ')
                    : 'Not set — no offers'}
                </FieldRow>
                <FieldRow label="Transmission">
                  {profile.vehicle_type_preferences.length > 0
                    ? profile.vehicle_type_preferences.join(', ')
                    : 'Not set — no offers'}
                </FieldRow>
              </DefinitionList>

              <DefinitionList>
                <FieldRow label="Hill Driving (Declared)">
                  {profile.can_drive_hill ? 'Yes' : 'No'}
                </FieldRow>
                <FieldRow label="Hill Driving (Verified)">
                  <div className="flex items-center gap-3">
                    <Badge tone={profile.can_drive_hill_verified ? 'success' : 'neutral'}>
                      {profile.can_drive_hill_verified ? 'Verified' : 'Not Verified'}
                    </Badge>
                    {profile.can_drive_hill && (
                      <Button
                        variant="secondary"
                        onClick={() => handleVerifyHillDriving(!profile.can_drive_hill_verified)}
                        loading={verifyHillDrivingMutation.isPending}
                      >
                        {profile.can_drive_hill_verified ? 'Revoke' : 'Verify'}
                      </Button>
                    )}
                  </div>
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
                  <button
                    key={doc.id}
                    onClick={() => setReviewingDoc(doc)}
                    className="text-left w-full flex gap-4 p-3 rounded-md bg-surface-sunken border border-transparent hover:border-interactive transition-colors cursor-pointer items-center"
                  >
                    <div className="relative flex-shrink-0 flex items-center justify-center w-16 h-16 overflow-hidden rounded bg-accent text-accent-ink">
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
                    </div>

                    <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-baseline gap-2 truncate">
                          {/* The side is part of the name, not a detail: a licence is two cards
                              now, and two identically-titled ones are a review you cannot aim. */}
                          <span className="font-semibold text-text text-sm leading-tight">
                            {doc.doc_type} · {doc.side}
                          </span>
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
                  </button>
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
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Documents are blurry or incomplete"
            className="w-full p-2 rounded-md bg-surface text-text text-sm border border-border-strong placeholder:text-text-subtle focus-visible:outline-2 focus-visible:outline-interactive min-h-[120px] resize-y"
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
        onOpenChange={(open) => {
          if (!open) {
            setReviewingDoc(null);
            setDocRejectReason('');
          }
        }}
        title={`View ${reviewingDoc?.doc_type ?? ''} ${reviewingDoc?.side ?? ''}`.trim()}
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

          {reviewingDoc && reviewingDoc.status !== 'VERIFIED' && (
            <div className="flex flex-col gap-4 pt-4 border-t border-border mt-4">
              <div className="flex gap-2 items-center">
                <Input
                  className="flex-1"
                  placeholder="Rejection reason (required if rejecting)"
                  value={docRejectReason}
                  onChange={(e) => setDocRejectReason(e.target.value)}
                />
                <Button
                  variant="danger"
                  disabled={!docRejectReason.trim()}
                  onClick={() => handleReviewDocument('REJECTED')}
                  loading={reviewDocumentMutation.isPending && docRejectReason.trim() !== ''}
                >
                  Reject Document
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleReviewDocument('VERIFIED')}
                  loading={reviewDocumentMutation.isPending && docRejectReason.trim() === ''}
                >
                  Verify Document
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
      {/* Suspend / Reinstate Dialog */}
      <Dialog
        open={confirmingSuspend}
        onOpenChange={(open) => {
          setConfirmingSuspend(open);
          if (!open) setSuspendReason('');
        }}
        title={profile.is_suspended ? `Reinstate ${profile.full_name || 'Driver'}` : `Suspend ${profile.full_name || 'Driver'}`}
        description={
          profile.is_suspended
            ? 'Are you sure you want to reinstate this driver? They will be able to log in and go on duty again.'
            : 'Are you sure you want to suspend this driver? They will immediately be taken off duty and blocked from taking bookings.'
        }
      >
        <div className="space-y-4 py-3">
          {!profile.is_suspended ? (
            <>
              <div className="text-xs text-text-subtle space-y-1.5 bg-surface-sunken p-3 rounded-md border border-border">
                <p className="font-medium text-text">Consequences of suspension:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>They will immediately be forced off-duty and any active shift ended.</li>
                  <li>They can no longer log in, receive offers, or accept bookings.</li>
                  <li>Their documents, past trip records, and wallet balances are preserved.</li>
                </ul>
              </div>
              <FormField label="Reason for suspension" required>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    placeholder="e.g. Policy violation, safety complaints, expired documents"
                    autoFocus
                  />
                )}
              </FormField>
            </>
          ) : (
            <div className="text-xs text-text-subtle space-y-1.5 bg-surface-sunken p-3 rounded-md border border-border">
              <p className="font-medium text-text">Upon reinstatement:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>The driver can log back into their driver app.</li>
                <li>They will be permitted to go on duty and receive trip requests again.</li>
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmingSuspend(false);
                setSuspendReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant={profile.is_suspended ? 'primary' : 'danger'}
              disabled={!profile.is_suspended && !suspendReason.trim()}
              loading={suspendMutation.isPending}
              onClick={async () => {
                try {
                  const isSuspending = !profile.is_suspended;
                  await suspendMutation.mutateAsync({
                    is_suspended: isSuspending,
                    reason: isSuspending ? suspendReason.trim() : 'Reinstated by admin',
                  });
                  setConfirmingSuspend(false);
                  setSuspendReason('');
                  toast.success(
                    isSuspending
                      ? `${profile.full_name || 'Driver'} suspended successfully`
                      : `${profile.full_name || 'Driver'} reinstated successfully`
                  );
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to update driver status');
                }
              }}
            >
              {profile.is_suspended ? 'Reinstate Driver' : 'Suspend Driver'}
            </Button>
          </div>
        </div>
      </Dialog>
      <DriverEditDialog
        driverId={isEditing ? id : undefined}
        onClose={() => setIsEditing(false)}
      />
    </>
  );
}
