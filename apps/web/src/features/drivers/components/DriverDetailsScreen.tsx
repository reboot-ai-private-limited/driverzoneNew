'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { User, CheckCircle, XCircle, FileText } from 'lucide-react';
import {
  Badge,
  Button,
  DataState,
  Dialog,
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

export function DriverDetailsScreen() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  const query = useDriverDetails(id);
  const approveMutation = useApproveDriver(id);
  const rejectMutation = useRejectDriver(id);

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

      <div className="flex flex-col gap-6 w-full">
        <Panel title="Personal Details">
          <div className="flex flex-col md:flex-row gap-8 mb-6">
            <div className="flex flex-col items-center shrink-0 w-full md:w-64">
              {profile.profile_picture ? (
                <img
                  src={profile.profile_picture}
                  alt={`${profile.full_name}'s profile`}
                  className="w-32 h-32 rounded-full object-cover border border-border mb-4"
                />
              ) : (
                <div className="w-32 h-32 rounded-full bg-surface-sunken border border-border flex items-center justify-center text-text-subtle mb-4">
                  <User className="w-12 h-12" />
                </div>
              )}
              <h3 className="text-lg font-semibold text-center">{profile.full_name || 'Unnamed Driver'}</h3>
              <div className="text-xs text-text-subtle tnum mt-1">ID: {profile.id}</div>

              <div className="mt-4 flex flex-col items-center gap-2">
                <StatusPill status={profile.onboarding_status} />
                {profile.onboarding_status === 'REJECTED' && profile.onboarding_rejection_reason && (
                  <div className="text-xs text-danger text-center mt-1">
                    <span className="font-semibold">Reason:</span> {profile.onboarding_rejection_reason}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-6 text-sm content-start">
              <div>
                <div className="text-text-subtle mb-1">Phone Number</div>
                <div className="font-medium tnum">{profile.mobile_number}</div>
              </div>
              <div>
                <div className="text-text-subtle mb-1">Alternate Phone</div>
                <div className="font-medium tnum">{profile.alternate_number || '—'}</div>
              </div>
              <div>
                <div className="text-text-subtle mb-1">Gender</div>
                <div className="font-medium">{profile.gender || '—'}</div>
              </div>
              <div>
                <div className="text-text-subtle mb-1">Date of Birth</div>
                <div className="font-medium tnum">{profile.dob || '—'}</div>
              </div>
              <div>
                <div className="text-text-subtle mb-1">Experience</div>
                <div className="font-medium tnum">{profile.experience_years ? `${profile.experience_years} years` : '—'}</div>
              </div>
              <div>
                <div className="text-text-subtle mb-1">Emergency Contact</div>
                <div className="font-medium">
                  {profile.emergency_contact ? (
                    <>
                      {profile.emergency_contact.name && <span className="mr-1">{profile.emergency_contact.name}</span>}
                      {profile.emergency_contact.number && <span className="tnum">({profile.emergency_contact.number})</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div className="col-span-2 md:col-span-3">
                <div className="text-text-subtle mb-1">Address</div>
                <div className="font-medium">{profile.address || '—'}</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Driving Preferences">
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="text-text-subtle mb-1">Vehicle Categories</div>
              <div className="font-medium">
                {profile.vehicle_category_preference.length > 0
                  ? profile.vehicle_category_preference.join(', ')
                  : 'Any'}
              </div>
            </div>
            <div>
              <div className="text-text-subtle mb-1">Transmission</div>
              <div className="font-medium">{profile.vehicle_type_preference || 'Any'}</div>
            </div>
            <div>
              <div className="text-text-subtle mb-1">Hill Driving (Declared)</div>
              <div className="font-medium">{profile.can_drive_hill ? 'Yes' : 'No'}</div>
            </div>
            <div>
              <div className="text-text-subtle mb-1">Hill Driving (Verified)</div>
              <div className="font-medium">
                <Badge tone={profile.can_drive_hill_verified ? 'success' : 'neutral'}>
                  {profile.can_drive_hill_verified ? 'Verified' : 'Not Verified'}
                </Badge>
              </div>
            </div>
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
                <div key={doc.id} className="flex gap-4 p-4 rounded-md border border-border bg-surface">
                  <button
                    onClick={() => setReviewingDoc(doc)}
                    className="relative flex-shrink-0 flex items-center justify-center w-24 h-24 overflow-hidden border border-border rounded bg-surface-sunken hover:border-interactive transition-colors"
                    aria-label="Preview document"
                  >
                    {doc.url ? (
                      doc.url.toLowerCase().endsWith('.pdf') ? (
                        <FileText className="size-8 text-text-subtle" />
                      ) : (
                        <img src={doc.url} alt={doc.doc_type} className="object-cover w-full h-full" />
                      )
                    ) : (
                      <span className="text-xs text-text-subtle">No file</span>
                    )}
                  </button>

                  <div className="flex flex-col flex-1 justify-between py-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="font-semibold text-text leading-tight">{doc.doc_type}</span>
                        {doc.number && <span className="text-sm font-medium text-text mt-1 tnum">{doc.number}</span>}
                        {doc.sub_type && <span className="text-xs text-text-subtle mt-0.5">{doc.sub_type}</span>}
                      </div>
                      <StatusPill status={doc.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs mt-3">
                      <div className="flex flex-col">
                        <span className="text-text-subtle">Issued</span>
                        <span className="font-medium tnum mt-0.5">{doc.issued_on || '—'}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-text-subtle">Expires</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={cn(
                            "font-medium tnum",
                            expStatus === 'EXPIRED' && "text-danger",
                            expStatus === 'EXPIRING_SOON' && "text-warning"
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
                    </div>

                    {doc.rejection_reason && (
                      <div className="text-xs text-danger mt-3 bg-danger/10 px-2 py-1 rounded">
                        <span className="font-semibold">Reason:</span> {doc.rejection_reason}
                      </div>
                    )}
                  </div>
                </div>
              )})}
            </div>
          )}
        </Panel>
      </div>

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
