import { useTranslation } from 'react-i18next';
import { Text } from '@/ui/components/Text';
import type { PdfForm } from '../../options/image';
import type { ToolFormProps } from '../../types';

export function ImageToPdfForm(_props: ToolFormProps<PdfForm>) {
  const { t } = useTranslation();
  return <Text className="text-sm text-muted-fg">{t('tools.image.toPdf.note')}</Text>;
}
